import base64
import os
import logging
from typing import AsyncIterator

from anthropic import AsyncAnthropic

from services.llm.base_provider import BaseLLMProvider

logger = logging.getLogger(__name__)


class AnthropicProvider(BaseLLMProvider):
    DEFAULT_MODEL = "claude-opus-4-20250514"

    def __init__(self):
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        self.client = AsyncAnthropic(api_key=api_key) if api_key else None

    @property
    def name(self) -> str:
        return "anthropic"

    @property
    def default_model(self) -> str:
        return self.DEFAULT_MODEL

    def is_available(self) -> bool:
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        return bool(api_key and api_key != "sk-ant-your-key-here")

    async def generate(self, system_prompt: str, user_prompt: str, model: str | None = None) -> dict:
        if not self.client:
            raise RuntimeError("Anthropic API key not configured")

        model = model or self.DEFAULT_MODEL
        response = await self.client.messages.create(
            model=model,
            max_tokens=16384,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        content = response.content[0].text
        return {"content": content, "provider": self.name, "model": model}

    async def generate_stream(
        self, system_prompt: str, user_prompt: str, model: str | None = None
    ) -> AsyncIterator[str]:
        if not self.client:
            raise RuntimeError("Anthropic API key not configured")

        model = model or self.DEFAULT_MODEL
        async with self.client.messages.stream(
            model=model,
            max_tokens=16384,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            async for text in stream.text_stream:
                yield text

    async def generate_with_images(
        self,
        system_prompt: str,
        user_prompt: str,
        images: list[bytes],
        model: str | None = None,
    ) -> dict:
        """Generate with Claude Vision — sends images as base64 content blocks."""
        if not self.client:
            raise RuntimeError("Anthropic API key not configured")

        model = model or self.DEFAULT_MODEL

        # Build content array: images first, then text prompt
        content = []
        for img_bytes in images:
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": base64.b64encode(img_bytes).decode("ascii"),
                },
            })
        content.append({"type": "text", "text": user_prompt})

        response = await self.client.messages.create(
            model=model,
            max_tokens=16384,
            system=system_prompt,
            messages=[{"role": "user", "content": content}],
        )
        text = response.content[0].text
        return {"content": text, "provider": self.name, "model": model}
