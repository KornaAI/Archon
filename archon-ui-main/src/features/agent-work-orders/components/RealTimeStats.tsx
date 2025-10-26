import { Activity, ChevronDown, ChevronUp, Clock, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/features/ui/primitives/button";
import { useAgentWorkOrdersStore } from "../state/agentWorkOrdersStore";
import { ExecutionLogs } from "./ExecutionLogs";

interface RealTimeStatsProps {
  /** Work order ID to stream logs for */
  workOrderId: string | undefined;
}

/**
 * Stable empty array reference to prevent infinite re-renders
 * CRITICAL: Never use `|| []` in Zustand selectors - creates new reference each render
 */
const EMPTY_LOGS: never[] = [];

/**
 * Format elapsed seconds to human-readable duration
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

export function RealTimeStats({ workOrderId }: RealTimeStatsProps) {
  const [showLogs, setShowLogs] = useState(false);

  // Zustand SSE slice - connection management
  const connectToLogs = useAgentWorkOrdersStore((s) => s.connectToLogs);
  const disconnectFromLogs = useAgentWorkOrdersStore((s) => s.disconnectFromLogs);

  // Subscribe to live data - selector returns raw store value (stable reference)
  const progress = useAgentWorkOrdersStore((s) => s.liveProgress[workOrderId ?? ""]);
  const logs = useAgentWorkOrdersStore((s) => s.liveLogs[workOrderId ?? ""]) || EMPTY_LOGS;

  // Live elapsed time that updates every second
  const [currentElapsedSeconds, setCurrentElapsedSeconds] = useState<number | null>(null);

  /**
   * Connect to SSE on mount, disconnect on unmount
   * Note: connectToLogs and disconnectFromLogs are stable Zustand actions
   */
  useEffect(() => {
    if (workOrderId) {
      connectToLogs(workOrderId);
      return () => disconnectFromLogs(workOrderId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrderId]);

  /**
   * Update elapsed time every second if work order is running
   */
  useEffect(() => {
    const isRunning = progress?.status !== "completed" && progress?.status !== "failed";
    if (!progress || !isRunning) {
      setCurrentElapsedSeconds(progress?.elapsedSeconds ?? null);
      return;
    }

    // Start from last known elapsed time or 0
    const startTime = Date.now();
    const initialElapsed = progress.elapsedSeconds || 0;

    const interval = setInterval(() => {
      const additionalSeconds = Math.floor((Date.now() - startTime) / 1000);
      setCurrentElapsedSeconds(initialElapsed + additionalSeconds);
    }, 1000);

    return () => clearInterval(interval);
  }, [progress?.status, progress?.elapsedSeconds, progress]);

  // Don't render if no progress data yet
  if (!progress || logs.length === 0) {
    return null;
  }

  const currentStep = progress.currentStep || "initializing";
  const stepDisplay =
    progress.stepNumber !== undefined && progress.totalSteps !== undefined
      ? `(${progress.stepNumber}/${progress.totalSteps})`
      : "";
  const progressPct = progress.progressPct || 0;
  const elapsedSeconds = currentElapsedSeconds !== null ? currentElapsedSeconds : progress.elapsedSeconds || 0;
  const latestLog = logs[logs.length - 1];
  const currentActivity = latestLog?.event || "Initializing workflow...";

  return (
    <div className="space-y-3">
      <div className="border border-white/10 dark:border-gray-700/30 rounded-lg p-4 bg-black/20 dark:bg-white/5 backdrop-blur">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-300 mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4" aria-hidden="true" />
          Real-Time Execution
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Current Step */}
          <div className="space-y-1">
            <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Current Step</div>
            <div className="text-sm font-medium text-gray-900 dark:text-gray-200">
              {currentStep}
              {stepDisplay && <span className="text-gray-500 dark:text-gray-400 ml-2">{stepDisplay}</span>}
            </div>
          </div>

          {/* Progress */}
          <div className="space-y-1">
            <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-1">
              <TrendingUp className="w-3 h-3" aria-hidden="true" />
              Progress
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-gray-700 dark:bg-gray-200/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-cyan-600 dark:text-cyan-400">{progressPct}%</span>
              </div>
            </div>
          </div>

          {/* Elapsed Time */}
          <div className="space-y-1">
            <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-1">
              <Clock className="w-3 h-3" aria-hidden="true" />
              Elapsed Time
            </div>
            <div className="text-sm font-medium text-gray-900 dark:text-gray-200">{formatDuration(elapsedSeconds)}</div>
          </div>
        </div>

        {/* Latest Activity with Status Indicator - at top */}
        <div className="mt-4 pt-3 border-t border-white/10 dark:border-gray-700/30">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">
                Latest Activity:
              </div>
              <div className="text-sm text-gray-900 dark:text-gray-300 flex-1 truncate">{currentActivity}</div>
            </div>
            {/* Status Indicator - right side of Latest Activity */}
            <div className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 flex-shrink-0">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span>Running</span>
            </div>
          </div>
        </div>

        {/* Show Execution Logs button - at bottom */}
        <div className="mt-3 pt-3 border-t border-white/10 dark:border-gray-700/30">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLogs(!showLogs)}
            className="w-full justify-center text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/10"
            aria-label={showLogs ? "Hide execution logs" : "Show execution logs"}
            aria-expanded={showLogs}
          >
            {showLogs ? (
              <>
                <ChevronUp className="w-4 h-4 mr-1" aria-hidden="true" />
                Hide Execution Logs
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4 mr-1" aria-hidden="true" />
                Show Execution Logs
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Collapsible Execution Logs */}
      {showLogs && <ExecutionLogs logs={logs} />}
    </div>
  );
}
