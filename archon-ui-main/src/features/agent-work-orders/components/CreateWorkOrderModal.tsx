/**
 * Create Work Order Modal Component
 *
 * Two-column modal for creating work orders with improved layout.
 * Left column (2/3): Form fields for repository, request, issue
 * Right column (1/3): Workflow steps selection
 */

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/features/ui/primitives/button";
import { Checkbox } from "@/features/ui/primitives/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/features/ui/primitives/dialog";
import { Input, TextArea } from "@/features/ui/primitives/input";
import { Label } from "@/features/ui/primitives/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/features/ui/primitives/select";
import { useCreateWorkOrder } from "../hooks/useAgentWorkOrderQueries";
import { useRepositories } from "../hooks/useRepositoryQueries";
import type { SandboxType, WorkflowStep } from "../types";

export interface CreateWorkOrderModalProps {
  /** Whether modal is open */
  open: boolean;

  /** Callback to change open state */
  onOpenChange: (open: boolean) => void;

  /** Pre-selected repository ID */
  selectedRepositoryId?: string;
}

/**
 * All available workflow steps with dependency info
 */
const WORKFLOW_STEPS: { value: WorkflowStep; label: string; dependsOn?: WorkflowStep[] }[] = [
  { value: "create-branch", label: "Create Branch" },
  { value: "planning", label: "Planning" },
  { value: "execute", label: "Execute" },
  { value: "commit", label: "Commit Changes", dependsOn: ["execute"] },
  { value: "create-pr", label: "Create Pull Request", dependsOn: ["execute"] },
  { value: "prp-review", label: "PRP Review" },
];

export function CreateWorkOrderModal({ open, onOpenChange, selectedRepositoryId }: CreateWorkOrderModalProps) {
  const { data: repositories = [] } = useRepositories();
  const createWorkOrder = useCreateWorkOrder();

  const [repositoryId, setRepositoryId] = useState(selectedRepositoryId || "");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [sandboxType, setSandboxType] = useState<SandboxType>("git_worktree");
  const [userRequest, setUserRequest] = useState("");
  const [githubIssueNumber, setGithubIssueNumber] = useState("");
  const [selectedCommands, setSelectedCommands] = useState<WorkflowStep[]>(["create-branch", "planning", "execute"]);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Pre-populate form when repository is selected
   */
  useEffect(() => {
    if (selectedRepositoryId) {
      setRepositoryId(selectedRepositoryId);
      const repo = repositories.find((r) => r.id === selectedRepositoryId);
      if (repo) {
        setRepositoryUrl(repo.repository_url);
        setSandboxType(repo.default_sandbox_type);
        setSelectedCommands(repo.default_commands as WorkflowStep[]);
      }
    }
  }, [selectedRepositoryId, repositories]);

  /**
   * Handle repository selection change
   */
  const handleRepositoryChange = (newRepositoryId: string) => {
    setRepositoryId(newRepositoryId);
    const repo = repositories.find((r) => r.id === newRepositoryId);
    if (repo) {
      setRepositoryUrl(repo.repository_url);
      setSandboxType(repo.default_sandbox_type);
      setSelectedCommands(repo.default_commands as WorkflowStep[]);
    }
  };

  /**
   * Toggle workflow step selection
   */
  const toggleStep = (step: WorkflowStep) => {
    setSelectedCommands((prev) => {
      if (prev.includes(step)) {
        return prev.filter((s) => s !== step);
      }
      return [...prev, step];
    });
  };

  /**
   * Check if a step is disabled based on dependencies
   */
  const isStepDisabled = (step: typeof WORKFLOW_STEPS[number]): boolean => {
    if (!step.dependsOn) return false;
    return step.dependsOn.some((dep) => !selectedCommands.includes(dep));
  };

  /**
   * Reset form state
   */
  const resetForm = () => {
    setRepositoryId(selectedRepositoryId || "");
    setRepositoryUrl("");
    setSandboxType("git_worktree");
    setUserRequest("");
    setGithubIssueNumber("");
    setSelectedCommands(["create-branch", "planning", "execute"]);
    setError("");
  };

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validation
    if (!repositoryUrl.trim()) {
      setError("Repository URL is required");
      return;
    }
    if (userRequest.trim().length < 10) {
      setError("Request must be at least 10 characters");
      return;
    }
    if (selectedCommands.length === 0) {
      setError("At least one workflow step must be selected");
      return;
    }

    try {
      setIsSubmitting(true);
      await createWorkOrder.mutateAsync({
        repository_url: repositoryUrl,
        sandbox_type: sandboxType,
        user_request: userRequest,
        github_issue_number: githubIssueNumber || undefined,
        selected_commands: selectedCommands,
      });

      // Success - close modal and reset
      resetForm();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create work order");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create Work Order</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="pt-4">
          <div className="grid grid-cols-3 gap-6">
            {/* Left Column (2/3 width) - Form Fields */}
            <div className="col-span-2 space-y-4">
              {/* Repository Selector */}
              <div className="space-y-2">
                <Label htmlFor="repository">Repository</Label>
                <Select value={repositoryId} onValueChange={handleRepositoryChange}>
                  <SelectTrigger id="repository" aria-label="Select repository">
                    <SelectValue placeholder="Select a repository..." />
                  </SelectTrigger>
                  <SelectContent>
                    {repositories.map((repo) => (
                      <SelectItem key={repo.id} value={repo.id}>
                        {repo.display_name || repo.repository_url}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* User Request */}
              <div className="space-y-2">
                <Label htmlFor="user-request">Work Request</Label>
                <TextArea
                  id="user-request"
                  placeholder="Describe the work you want the agent to perform..."
                  rows={4}
                  value={userRequest}
                  onChange={(e) => setUserRequest(e.target.value)}
                  aria-invalid={!!error && userRequest.length < 10}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">Minimum 10 characters</p>
              </div>

              {/* GitHub Issue Number (optional) */}
              <div className="space-y-2">
                <Label htmlFor="github-issue">GitHub Issue Number (Optional)</Label>
                <Input
                  id="github-issue"
                  type="text"
                  placeholder="e.g., 42"
                  value={githubIssueNumber}
                  onChange={(e) => setGithubIssueNumber(e.target.value)}
                />
              </div>

              {/* Sandbox Type */}
              <div className="space-y-2">
                <Label htmlFor="sandbox-type">Sandbox Type</Label>
                <Select value={sandboxType} onValueChange={(value) => setSandboxType(value as SandboxType)}>
                  <SelectTrigger id="sandbox-type" aria-label="Select sandbox type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="git_worktree">Git Worktree (Recommended)</SelectItem>
                    <SelectItem value="git_branch">Git Branch</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Right Column (1/3 width) - Workflow Steps */}
            <div className="space-y-4">
              <Label>Workflow Steps</Label>
              <div className="space-y-2">
                {WORKFLOW_STEPS.map((step) => {
                  const isSelected = selectedCommands.includes(step.value);
                  const isDisabled = isStepDisabled(step);

                  return (
                    <div key={step.value} className="flex items-center gap-2">
                      <Checkbox
                        id={`step-${step.value}`}
                        checked={isSelected}
                        onCheckedChange={() => !isDisabled && toggleStep(step.value)}
                        disabled={isDisabled}
                        aria-label={step.label}
                      />
                      <Label htmlFor={`step-${step.value}`} className={isDisabled ? "text-gray-400" : ""}>
                        {step.label}
                      </Label>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Commit and PR require Execute</p>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mt-4 text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded p-3">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-6 mt-6 border-t border-gray-200 dark:border-gray-700">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} variant="cyan">
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  Creating...
                </>
              ) : (
                "Create Work Order"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
