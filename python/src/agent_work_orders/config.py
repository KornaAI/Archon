"""Configuration Management

Loads configuration from environment variables with sensible defaults.
"""

import os
from pathlib import Path


def get_project_root() -> Path:
    """Get the project root directory (one level up from python/)"""
    # This file is in python/src/agent_work_orders/config.py
    # So go up 3 levels to get to project root
    return Path(__file__).parent.parent.parent.parent


class AgentWorkOrdersConfig:
    """Configuration for Agent Work Orders service"""

    CLAUDE_CLI_PATH: str = os.getenv("CLAUDE_CLI_PATH", "claude")
    EXECUTION_TIMEOUT: int = int(os.getenv("AGENT_WORK_ORDER_TIMEOUT", "3600"))

    # Default to python/.claude/commands/agent-work-orders
    _python_root = Path(__file__).parent.parent.parent
    _default_commands_dir = str(_python_root / ".claude" / "commands" / "agent-work-orders")
    COMMANDS_DIRECTORY: str = os.getenv("AGENT_WORK_ORDER_COMMANDS_DIR", _default_commands_dir)

    TEMP_DIR_BASE: str = os.getenv("AGENT_WORK_ORDER_TEMP_DIR", "/tmp/agent-work-orders")
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    GH_CLI_PATH: str = os.getenv("GH_CLI_PATH", "gh")

    # Claude CLI flags configuration
    # --verbose: Required when using --print with --output-format=stream-json
    CLAUDE_CLI_VERBOSE: bool = os.getenv("CLAUDE_CLI_VERBOSE", "true").lower() == "true"

    # --max-turns: Optional limit for agent executions. Set to None for unlimited.
    # Default: None (no limit - let agent run until completion)
    _max_turns_env = os.getenv("CLAUDE_CLI_MAX_TURNS")
    CLAUDE_CLI_MAX_TURNS: int | None = int(_max_turns_env) if _max_turns_env else None

    # --model: Claude model to use (sonnet, opus, haiku)
    CLAUDE_CLI_MODEL: str = os.getenv("CLAUDE_CLI_MODEL", "sonnet")

    # --dangerously-skip-permissions: Required for non-interactive automation
    CLAUDE_CLI_SKIP_PERMISSIONS: bool = os.getenv("CLAUDE_CLI_SKIP_PERMISSIONS", "true").lower() == "true"

    # Logging configuration
    # Enable saving prompts and outputs for debugging
    ENABLE_PROMPT_LOGGING: bool = os.getenv("ENABLE_PROMPT_LOGGING", "true").lower() == "true"
    ENABLE_OUTPUT_ARTIFACTS: bool = os.getenv("ENABLE_OUTPUT_ARTIFACTS", "true").lower() == "true"

    @classmethod
    def ensure_temp_dir(cls) -> Path:
        """Ensure temp directory exists and return Path"""
        temp_dir = Path(cls.TEMP_DIR_BASE)
        temp_dir.mkdir(parents=True, exist_ok=True)
        return temp_dir


# Global config instance
config = AgentWorkOrdersConfig()
