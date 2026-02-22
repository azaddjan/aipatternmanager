import os
import logging

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
            max_tokens=4096,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        content = response.content[0].text
        return {"content": content, "provider": self.name, "model": model}
