"""Workflow Orchestrator

Main orchestration logic for workflow execution.
"""

from ..agent_executor.agent_cli_executor import AgentCLIExecutor
from ..command_loader.claude_command_loader import ClaudeCommandLoader
from ..github_integration.github_client import GitHubClient
from ..models import (
    AgentWorkOrderStatus,
    SandboxType,
    StepHistory,
    WorkflowExecutionError,
)
from ..sandbox_manager.sandbox_factory import SandboxFactory
from ..state_manager.file_state_repository import FileStateRepository
from ..state_manager.work_order_repository import WorkOrderRepository
from ..utils.git_operations import get_commit_count, get_files_changed
from ..utils.id_generator import generate_sandbox_identifier
from ..utils.structured_logger import get_logger
from . import workflow_operations

logger = get_logger(__name__)


class WorkflowOrchestrator:
    """Orchestrates workflow execution"""

    def __init__(
        self,
        agent_executor: AgentCLIExecutor,
        sandbox_factory: SandboxFactory,
        github_client: GitHubClient,
        command_loader: ClaudeCommandLoader,
        state_repository: WorkOrderRepository | FileStateRepository,
    ):
        self.agent_executor = agent_executor
        self.sandbox_factory = sandbox_factory
        self.github_client = github_client
        self.command_loader = command_loader
        self.state_repository = state_repository
        self._logger = logger

    async def execute_workflow(
        self,
        agent_work_order_id: str,
        repository_url: str,
        sandbox_type: SandboxType,
        user_request: str,
        selected_commands: list[str] | None = None,
        github_issue_number: str | None = None,
    ) -> None:
        """Execute user-selected commands in sequence

        This runs in the background and updates state as it progresses.

        Args:
            agent_work_order_id: Work order ID
            repository_url: Git repository URL
            sandbox_type: Sandbox environment type
            user_request: User's description of the work to be done
            selected_commands: Commands to run in sequence (default: full workflow)
            github_issue_number: Optional GitHub issue number
        """
        # Default commands if not provided
        if selected_commands is None:
            selected_commands = ["create-branch", "planning", "execute", "commit", "create-pr"]

        bound_logger = self._logger.bind(
            agent_work_order_id=agent_work_order_id,
            sandbox_type=sandbox_type.value,
            selected_commands=selected_commands,
        )

        bound_logger.info("agent_work_order_started")

        # Initialize step history and context
        step_history = StepHistory(agent_work_order_id=agent_work_order_id)
        context = {
            "user_request": user_request,
            "github_issue_number": github_issue_number,
        }

        sandbox = None

        try:
            # Update status to RUNNING
            await self.state_repository.update_status(
                agent_work_order_id, AgentWorkOrderStatus.RUNNING
            )

            # Create sandbox
            sandbox_identifier = generate_sandbox_identifier(agent_work_order_id)
            sandbox = self.sandbox_factory.create_sandbox(
                sandbox_type, repository_url, sandbox_identifier
            )
            await sandbox.setup()
            bound_logger.info("sandbox_created", sandbox_identifier=sandbox_identifier)

            # Command mapping
            command_map = {
                "create-branch": workflow_operations.run_create_branch_step,
                "planning": workflow_operations.run_planning_step,
                "execute": workflow_operations.run_execute_step,
                "commit": workflow_operations.run_commit_step,
                "create-pr": workflow_operations.run_create_pr_step,
                "prp-review": workflow_operations.run_review_step,
            }

            # Execute each command in sequence
            for command_name in selected_commands:
                if command_name not in command_map:
                    raise WorkflowExecutionError(f"Unknown command: {command_name}")

                bound_logger.info("command_execution_started", command=command_name)

                command_func = command_map[command_name]

                # Execute command
                result = await command_func(
                    executor=self.agent_executor,
                    command_loader=self.command_loader,
                    work_order_id=agent_work_order_id,
                    working_dir=sandbox.working_dir,
                    context=context,
                )

                # Save step result
                step_history.steps.append(result)
                await self.state_repository.save_step_history(
                    agent_work_order_id, step_history
                )

                # Log completion
                bound_logger.info(
                    "command_execution_completed",
                    command=command_name,
                    success=result.success,
                    duration=result.duration_seconds,
                )

                # STOP on failure
                if not result.success:
                    await self.state_repository.update_status(
                        agent_work_order_id,
                        AgentWorkOrderStatus.FAILED,
                        error_message=result.error_message,
                    )
                    raise WorkflowExecutionError(
                        f"Command '{command_name}' failed: {result.error_message}"
                    )

                # Store output in context for next command
                context[command_name] = result.output

                # Special handling for specific commands
                if command_name == "create-branch":
                    await self.state_repository.update_git_branch(
                        agent_work_order_id, result.output or ""
                    )
                elif command_name == "create-pr":
                    # Calculate git stats before marking as completed
                    # Branch name is stored in context from create-branch step
                    branch_name = context.get("create-branch")
                    git_stats = await self._calculate_git_stats(
                        branch_name,
                        sandbox.working_dir
                    )

                    await self.state_repository.update_status(
                        agent_work_order_id,
                        AgentWorkOrderStatus.COMPLETED,
                        github_pull_request_url=result.output,
                        git_commit_count=git_stats["commit_count"],
                        git_files_changed=git_stats["files_changed"],
                    )
                    # Save final step history
                    await self.state_repository.save_step_history(agent_work_order_id, step_history)
                    bound_logger.info(
                        "agent_work_order_completed",
                        total_steps=len(step_history.steps),
                        git_commit_count=git_stats["commit_count"],
                        git_files_changed=git_stats["files_changed"],
                    )
                    return  # Exit early if PR created

            # Calculate git stats for workflows that complete without PR
            branch_name = context.get("create-branch")
            if branch_name:
                git_stats = await self._calculate_git_stats(
                    branch_name, sandbox.working_dir
                )
                await self.state_repository.update_status(
                    agent_work_order_id,
                    AgentWorkOrderStatus.COMPLETED,
                    git_commit_count=git_stats["commit_count"],
                    git_files_changed=git_stats["files_changed"],
                )

            # Save final step history
            await self.state_repository.save_step_history(agent_work_order_id, step_history)
            bound_logger.info("agent_work_order_completed", total_steps=len(step_history.steps))

        except Exception as e:
            error_msg = str(e)
            bound_logger.error("agent_work_order_failed", error=error_msg, exc_info=True)

            # Save partial step history even on failure
            await self.state_repository.save_step_history(agent_work_order_id, step_history)

            await self.state_repository.update_status(
                agent_work_order_id,
                AgentWorkOrderStatus.FAILED,
                error_message=error_msg,
            )

        finally:
            # Cleanup sandbox
            if sandbox:
                try:
                    await sandbox.cleanup()
                    bound_logger.info("sandbox_cleanup_completed")
                except Exception as cleanup_error:
                    bound_logger.error(
                        "sandbox_cleanup_failed",
                        error=str(cleanup_error),
                        exc_info=True,
                    )

    async def _calculate_git_stats(
        self, branch_name: str | None, repo_path: str
    ) -> dict[str, int]:
        """Calculate git statistics for a branch

        Args:
            branch_name: Name of the git branch
            repo_path: Path to the repository

        Returns:
            Dictionary with commit_count and files_changed
        """
        if not branch_name:
            return {"commit_count": 0, "files_changed": 0}

        try:
            # Calculate stats compared to main branch
            commit_count = await get_commit_count(branch_name, repo_path)
            files_changed = await get_files_changed(branch_name, repo_path, base_branch="main")

            return {
                "commit_count": commit_count,
                "files_changed": files_changed,
            }
        except Exception as e:
            logger.warning(
                "git_stats_calculation_failed",
                branch_name=branch_name,
                error=str(e),
            )
            return {"commit_count": 0, "files_changed": 0}
