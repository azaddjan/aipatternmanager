import os
import logging
from typing import AsyncIterator

from openai import AsyncOpenAI

from services.llm.base_provider import BaseLLMProvider

logger = logging.getLogger(__name__)


class OpenAIProvider(BaseLLMProvider):
    DEFAULT_MODEL = "gpt-4o"

    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY", "")
        self.client = AsyncOpenAI(api_key=api_key) if api_key else None

    @property
    def name(self) -> str:
        return "openai"

    @property
    def default_model(self) -> str:
        return self.DEFAULT_MODEL

    def is_available(self) -> bool:
        api_key = os.getenv("OPENAI_API_KEY", "")
        return bool(api_key and api_key != "sk-your-key-here")

    async def generate(self, system_prompt: str, user_prompt: str, model: str | None = None) -> dict:
        if not self.client:
            raise RuntimeError("OpenAI API key not configured")

        model = model or self.DEFAULT_MODEL
        response = await self.client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=8192,
        )
        content = response.choices[0].message.content
        return {"content": content, "provider": self.name, "model": model}

    async def generate_stream(
        self, system_prompt: str, user_prompt: str, model: str | None = None
    ) -> AsyncIterator[str]:
        if not self.client:
            raise RuntimeError("OpenAI API key not configured")

        model = model or self.DEFAULT_MODEL
        stream = await self.client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=8192,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta
            if delta.content:
                yield delta.content
