import os
import logging

from ollama import AsyncClient

from services.llm.base_provider import BaseLLMProvider

logger = logging.getLogger(__name__)


class OllamaProvider(BaseLLMProvider):
    DEFAULT_MODEL = "llama3.1"

    def __init__(self):
        self.base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        self.client = AsyncClient(host=self.base_url)

    @property
    def name(self) -> str:
        return "ollama"

    @property
    def default_model(self) -> str:
        return self.DEFAULT_MODEL

    def is_available(self) -> bool:
        # Ollama availability is checked by attempting a connection;
        # for now we assume it's available if the URL is set
        return bool(self.base_url)

    async def generate(self, system_prompt: str, user_prompt: str, model: str | None = None) -> dict:
        model = model or self.DEFAULT_MODEL
        response = await self.client.chat(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        content = response["message"]["content"]
        return {"content": content, "provider": self.name, "model": model}
