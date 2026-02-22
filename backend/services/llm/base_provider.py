from abc import ABC, abstractmethod


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
