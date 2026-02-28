import os
import json
import logging

from services.llm.base_provider import BaseLLMProvider

logger = logging.getLogger(__name__)


class BedrockProvider(BaseLLMProvider):
    """AWS Bedrock LLM provider using boto3."""

    DEFAULT_MODEL = "anthropic.claude-sonnet-4-20250514-v1:0"

    MODELS = {
        "anthropic.claude-sonnet-4-20250514-v1:0": "Claude Sonnet 4 (Bedrock)",
        "anthropic.claude-opus-4-20250514-v1:0": "Claude Opus 4 (Bedrock)",
        "anthropic.claude-3-5-sonnet-20241022-v2:0": "Claude 3.5 Sonnet v2 (Bedrock)",
        "amazon.titan-text-premier-v1:0": "Amazon Titan Text Premier",
        "meta.llama3-1-70b-instruct-v1:0": "Llama 3.1 70B (Bedrock)",
    }

    def __init__(self):
        self._client = None
        self._region = os.getenv("AWS_DEFAULT_REGION", "us-east-1")

    def _get_client(self):
        if self._client is None:
            try:
                import boto3
                session_kwargs = {}
                profile = os.getenv("AWS_PROFILE", "")
                if profile:
                    session_kwargs["profile_name"] = profile
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
            except Exception as e:
                logger.warning(f"Failed to create Bedrock client: {e}")
                self._client = None
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
        client = self._get_client()
        if not client:
            raise RuntimeError("AWS Bedrock not configured — missing AWS credentials")

        model = model or self.DEFAULT_MODEL

        # Anthropic models on Bedrock use Converse API
        if model.startswith("anthropic."):
            return await self._generate_anthropic(client, system_prompt, user_prompt, model)
        else:
            return await self._generate_converse(client, system_prompt, user_prompt, model)

    async def _generate_anthropic(self, client, system_prompt: str, user_prompt: str, model: str) -> dict:
        """Use the Bedrock Converse API (works for all models including Anthropic)."""
        import asyncio

        def _invoke():
            response = client.converse(
                modelId=model,
                system=[{"text": system_prompt}],
                messages=[
                    {"role": "user", "content": [{"text": user_prompt}]}
                ],
                inferenceConfig={"maxTokens": 8192, "temperature": 0.7},
            )
            return response["output"]["message"]["content"][0]["text"]

        content = await asyncio.get_event_loop().run_in_executor(None, _invoke)
        return {"content": content, "provider": self.name, "model": model}

    async def _generate_converse(self, client, system_prompt: str, user_prompt: str, model: str) -> dict:
        """Generic Converse API call for non-Anthropic models on Bedrock."""
        import asyncio

        def _invoke():
            response = client.converse(
                modelId=model,
                system=[{"text": system_prompt}],
                messages=[
                    {"role": "user", "content": [{"text": user_prompt}]}
                ],
                inferenceConfig={"maxTokens": 8192, "temperature": 0.7},
            )
            return response["output"]["message"]["content"][0]["text"]

        content = await asyncio.get_event_loop().run_in_executor(None, _invoke)
        return {"content": content, "provider": self.name, "model": model}
