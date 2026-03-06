from abc import ABC, abstractmethod
from typing import AsyncIterator


class BaseLLMProvider(ABC):
    """Abstract base class for LLM providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name (e.g., 'anthropic', 'openai', 'ollama')."""
        ...

    @property
    @abstractmethod
    def default_model(self) -> str:
        """Default model ID for this provider."""
        ...

    @abstractmethod
    def is_available(self) -> bool:
        """Check if the provider is configured and reachable."""
        ...

    @abstractmethod
    async def generate(self, system_prompt: str, user_prompt: str, model: str | None = None) -> dict:
        """Generate a completion.

        Returns:
            {"content": str, "provider": str, "model": str}
        """
        ...

    async def generate_stream(
        self, system_prompt: str, user_prompt: str, model: str | None = None
    ) -> AsyncIterator[str]:
        """Stream a completion token-by-token.

        Yields text chunks as they arrive. Default implementation falls back
        to non-streaming generate() and yields the full content at once.
        Providers with native streaming support should override.
        """
        result = await self.generate(system_prompt, user_prompt, model)
        yield result["content"]

    async def generate_with_images(
        self,
        system_prompt: str,
        user_prompt: str,
        images: list[bytes],
        model: str | None = None,
    ) -> dict:
        """Generate a completion with image inputs (vision).

        Default implementation falls back to text-only generation.
        Providers with vision support (Anthropic, OpenAI) should override.

        Args:
            images: List of PNG image byte arrays.

        Returns:
            {"content": str, "provider": str, "model": str}
        """
        return await self.generate(system_prompt, user_prompt, model)

    async def list_models(self) -> list[str]:
        """Fetch available model IDs from the provider API.

        Returns a list of model ID strings. Default returns empty list;
        providers with dynamic model listing should override.
        """
        return []
