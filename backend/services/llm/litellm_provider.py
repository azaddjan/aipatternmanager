"""
LiteLLM Gateway provider — connects to a LiteLLM proxy via its
OpenAI-compatible /v1/chat/completions endpoint.

Uses the existing `openai` SDK with a custom base_url, so no new
pip dependency is required.
"""
import os
import logging
from typing import AsyncIterator

from openai import AsyncOpenAI

from services.llm.base_provider import BaseLLMProvider

logger = logging.getLogger(__name__)


class LiteLLMProvider(BaseLLMProvider):

    DEFAULT_MODEL = "bedrock/anthropic.claude-3-sonnet-20240229-v1:0"

    def __init__(self):
        self._client = None
        self._gateway_url = os.getenv("LITELLM_GATEWAY_URL", "")
        self._api_key = os.getenv("LITELLM_API_KEY", "")
        if self._gateway_url:
            self._init_client()

    def _init_client(self):
        url = self._gateway_url.rstrip("/")
        if not url.endswith("/v1"):
            url += "/v1"
        self._client = AsyncOpenAI(
            base_url=url,
            api_key=self._api_key or "not-needed",
        )

    @property
    def name(self) -> str:
        return "litellm"

    @property
    def default_model(self) -> str:
        return self.DEFAULT_MODEL

    def is_available(self) -> bool:
        return bool(self._gateway_url)

    async def generate(
        self, system_prompt: str, user_prompt: str, model: str | None = None
    ) -> dict:
        if not self._client:
            raise RuntimeError("LiteLLM Gateway URL not configured")

        model = model or self.DEFAULT_MODEL
        response = await self._client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=16384,
        )
        content = response.choices[0].message.content
        return {"content": content, "provider": self.name, "model": model}

    async def generate_stream(
        self, system_prompt: str, user_prompt: str, model: str | None = None
    ) -> AsyncIterator[str]:
        if not self._client:
            raise RuntimeError("LiteLLM Gateway URL not configured")

        model = model or self.DEFAULT_MODEL
        stream = await self._client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=16384,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta
            if delta.content:
                yield delta.content

    FALLBACK_MODELS = [
        "bedrock/anthropic.claude-3-sonnet-20240229-v1:0",
        "bedrock/anthropic.claude-3-haiku-20240307-v1:0",
        "openai/gpt-4o",
        "openai/gpt-4o-mini",
    ]

    async def list_models(self) -> list[str]:
        if not self._client:
            return self.FALLBACK_MODELS
        try:
            response = await self._client.models.list()
            models = [m.id for m in response.data]
            return sorted(models) if models else self.FALLBACK_MODELS
        except Exception as e:
            logger.warning(f"Failed to fetch LiteLLM models: {e}")
            return self.FALLBACK_MODELS
