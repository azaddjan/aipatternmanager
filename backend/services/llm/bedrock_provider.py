import os
import json
import logging

from services.llm.base_provider import BaseLLMProvider

logger = logging.getLogger(__name__)


class BedrockProvider(BaseLLMProvider):
    """AWS Bedrock LLM provider using boto3."""

    DEFAULT_MODEL = "us.anthropic.claude-sonnet-4-20250514-v1:0"

    MODELS = {
        "us.anthropic.claude-sonnet-4-20250514-v1:0": "Claude Sonnet 4 (Bedrock)",
        "us.anthropic.claude-opus-4-20250514-v1:0": "Claude Opus 4 (Bedrock)",
        "us.anthropic.claude-3-5-sonnet-20241022-v2:0": "Claude 3.5 Sonnet v2 (Bedrock)",
        "amazon.titan-text-premier-v1:0": "Amazon Titan Text Premier",
        "meta.llama3-1-70b-instruct-v1:0": "Llama 3.1 70B (Bedrock)",
    }

    def __init__(self):
        self._client = None
        self._region = self._resolve_region()

    @staticmethod
    def _resolve_region() -> str:
        """Return region from env var first, then from saved settings, fallback us-east-1."""
        env_region = os.getenv("AWS_DEFAULT_REGION", "")
        if env_region:
            return env_region
        try:
            from services.settings_service import get_settings
            settings = get_settings()
            return settings.get("providers", {}).get("bedrock", {}).get("region", "") or "us-east-1"
        except Exception:
            return "us-east-1"

    def _get_client(self):
        if self._client is None:
            import boto3
            session_kwargs = {}
            profile = os.getenv("AWS_PROFILE", "")
            if profile:
                session_kwargs["profile_name"] = profile
            elif "AWS_PROFILE" in os.environ:
                # Remove empty AWS_PROFILE so boto3 doesn't try to find profile ""
                del os.environ["AWS_PROFILE"]
            session = boto3.Session(**session_kwargs)
            client_kwargs = {"region_name": self._region}
            # Only pass explicit credentials if set (otherwise boto3 uses its
            # standard chain: env vars, ~/.aws/credentials, instance role, etc.)
            ak = os.getenv("AWS_ACCESS_KEY_ID", "")
            sk = os.getenv("AWS_SECRET_ACCESS_KEY", "")
            if ak and sk:
                client_kwargs["aws_access_key_id"] = ak
                client_kwargs["aws_secret_access_key"] = sk
                st = os.getenv("AWS_SESSION_TOKEN", "")
                if st:
                    client_kwargs["aws_session_token"] = st
            self._client = session.client("bedrock-runtime", **client_kwargs)
        return self._client

    @property
    def name(self) -> str:
        return "bedrock"

    @property
    def default_model(self) -> str:
        return self.DEFAULT_MODEL

    def is_available(self) -> bool:
        key = os.getenv("AWS_ACCESS_KEY_ID", "")
        secret = os.getenv("AWS_SECRET_ACCESS_KEY", "")
        profile = os.getenv("AWS_PROFILE", "")
        # Available if explicit keys provided OR an AWS profile is set
        if profile:
            return True
        return bool(key and secret and key != "your-key-here")

    async def generate(self, system_prompt: str, user_prompt: str, model: str | None = None) -> dict:
        try:
            client = self._get_client()
        except Exception as e:
            logger.error(f"Failed to create Bedrock client: {e}")
            raise RuntimeError(f"AWS Bedrock client error: {e}") from e

        model = model or self.DEFAULT_MODEL

        # Anthropic models on Bedrock use Converse API
        if model.startswith("anthropic.") or model.startswith("us.anthropic."):
            return await self._generate_anthropic(client, system_prompt, user_prompt, model)
        else:
            return await self._generate_converse(client, system_prompt, user_prompt, model)

    def _get_guardrail_config(self) -> dict | None:
        """Return guardrailConfig dict if configured in settings, else None."""
        try:
            from services.settings_service import get_settings
            settings = get_settings()
            bedrock_cfg = settings.get("providers", {}).get("bedrock", {})
            gid = bedrock_cfg.get("guardrail_id", "").strip()
            gver = bedrock_cfg.get("guardrail_version", "").strip()
            if gid and gver:
                return {"guardrailIdentifier": gid, "guardrailVersion": gver}
        except Exception as e:
            logger.warning(f"Failed to load guardrail config: {e}")
        return None

    async def _generate_anthropic(self, client, system_prompt: str, user_prompt: str, model: str) -> dict:
        """Use the Bedrock Converse API (works for all models including Anthropic)."""
        import asyncio
        guardrail_config = self._get_guardrail_config()

        def _invoke():
            kwargs = dict(
                modelId=model,
                system=[{"text": system_prompt}],
                messages=[
                    {"role": "user", "content": [{"text": user_prompt}]}
                ],
                inferenceConfig={"maxTokens": 16384, "temperature": 0.7},
            )
            if guardrail_config:
                kwargs["guardrailConfig"] = guardrail_config
            response = client.converse(**kwargs)
            return response["output"]["message"]["content"][0]["text"]

        content = await asyncio.get_event_loop().run_in_executor(None, _invoke)
        return {"content": content, "provider": self.name, "model": model}

    FALLBACK_MODELS = [
        "us.anthropic.claude-sonnet-4-20250514-v1:0",
        "us.anthropic.claude-opus-4-20250514-v1:0",
        "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
        "amazon.titan-text-premier-v1:0",
        "meta.llama3-1-70b-instruct-v1:0",
    ]

    def _get_management_client(self):
        """Create a bedrock (non-runtime) client for listing models."""
        import boto3
        session_kwargs = {}
        profile = os.getenv("AWS_PROFILE", "")
        if profile:
            session_kwargs["profile_name"] = profile
        elif "AWS_PROFILE" in os.environ:
            del os.environ["AWS_PROFILE"]
        session = boto3.Session(**session_kwargs)
        client_kwargs = {"region_name": self._region}
        ak = os.getenv("AWS_ACCESS_KEY_ID", "")
        sk = os.getenv("AWS_SECRET_ACCESS_KEY", "")
        if ak and sk:
            client_kwargs["aws_access_key_id"] = ak
            client_kwargs["aws_secret_access_key"] = sk
            st = os.getenv("AWS_SESSION_TOKEN", "")
            if st:
                client_kwargs["aws_session_token"] = st
        return session.client("bedrock", **client_kwargs)

    async def list_models(self) -> list[str]:
        import asyncio

        try:
            mgmt_client = self._get_management_client()

            def _fetch():
                resp = mgmt_client.list_foundation_models(byOutputModality="TEXT")
                return [s["modelId"] for s in resp.get("modelSummaries", []) if s.get("modelId")]

            models = await asyncio.get_event_loop().run_in_executor(None, _fetch)
            return sorted(models) if models else self.FALLBACK_MODELS
        except Exception as e:
            logger.warning(f"Failed to fetch Bedrock models: {e}")
            return self.FALLBACK_MODELS

    async def _generate_converse(self, client, system_prompt: str, user_prompt: str, model: str) -> dict:
        """Generic Converse API call for non-Anthropic models on Bedrock."""
        import asyncio
        guardrail_config = self._get_guardrail_config()

        def _invoke():
            kwargs = dict(
                modelId=model,
                system=[{"text": system_prompt}],
                messages=[
                    {"role": "user", "content": [{"text": user_prompt}]}
                ],
                inferenceConfig={"maxTokens": 16384, "temperature": 0.7},
            )
            if guardrail_config:
                kwargs["guardrailConfig"] = guardrail_config
            response = client.converse(**kwargs)
            return response["output"]["message"]["content"][0]["text"]

        content = await asyncio.get_event_loop().run_in_executor(None, _invoke)
        return {"content": content, "provider": self.name, "model": model}
