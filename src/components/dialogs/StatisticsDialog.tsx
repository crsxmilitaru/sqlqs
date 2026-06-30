import { createSignal, onMount, Show, For } from "solid-js";
import type { QueryStatistics } from "../../lib/types";
import DialogCloseButton from "../ui/DialogCloseButton";
import DialogShell from "../ui/DialogShell";

interface Props {
  statistics: QueryStatistics;
  onClose: () => void;
}

export default function StatisticsDialog(props: Props) {
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    requestAnimationFrame(() => setVisible(true));
  });

  const totalCpu = () =>
    props.statistics.parseAndCompileCpuTimeMs +
    props.statistics.executionCpuTimeMs;

  const totalElapsed = () =>
    props.statistics.parseAndCompileElapsedTimeMs +
    props.statistics.executionElapsedTimeMs;

  const totalReads = () =>
    props.statistics.tableIo.reduce(
      (acc, t) =>
        acc +
        t.logicalReads +
        t.physicalReads +
        t.readAheadReads +
        t.lobLogicalReads +
        t.lobPhysicalReads +
        t.lobReadAheadReads,
      0,
    );

  return (
    <DialogShell
      visible={visible()}
      onClose={props.onClose}
      class="w-[min(760px,calc(100vw-32px))] max-h-[min(720px,calc(100vh-32px))] shadow-2xl flex flex-col overflow-hidden"
      ariaLabel="Query Statistics"
    >
      <div class="flex items-center justify-between px-6 py-4 border-b border-overlay-xs bg-transparent flex-shrink-0">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-chart-simple text-accent text-m" />
          <h2 class="text-m font-semibold text-text">Query Execution Statistics</h2>
        </div>
        <DialogCloseButton onClick={props.onClose} />
      </div>

      <div class="p-6 flex-1 min-h-0 flex flex-col gap-6 overflow-y-auto overflow-x-hidden">
        {/* KPI Cards */}
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="bg-surface-hover/30 p-4 rounded-xl border border-border/15 flex flex-col gap-1">
            <span class="text-xs uppercase font-medium text-text-muted/70 tracking-wider">Total CPU Time</span>
            <span class="text-xl font-bold text-text font-mono">{totalCpu()} ms</span>
            <div class="text-[10px] text-text-muted flex gap-2 mt-1">
              <span>Compile: {props.statistics.parseAndCompileCpuTimeMs}ms</span>
              <span class="opacity-30">|</span>
              <span>Exec: {props.statistics.executionCpuTimeMs}ms</span>
            </div>
          </div>

          <div class="bg-surface-hover/30 p-4 rounded-xl border border-border/15 flex flex-col gap-1">
            <span class="text-xs uppercase font-medium text-text-muted/70 tracking-wider">Total Elapsed Time</span>
            <span class="text-xl font-bold text-text font-mono">{totalElapsed()} ms</span>
            <div class="text-[10px] text-text-muted flex gap-2 mt-1">
              <span>Compile: {props.statistics.parseAndCompileElapsedTimeMs}ms</span>
              <span class="opacity-30">|</span>
              <span>Exec: {props.statistics.executionElapsedTimeMs}ms</span>
            </div>
          </div>

          <div class="bg-surface-hover/30 p-4 rounded-xl border border-border/15 flex flex-col gap-1">
            <span class="text-xs uppercase font-medium text-text-muted/70 tracking-wider">Total Reads</span>
            <span class="text-xl font-bold text-text font-mono">{totalReads().toLocaleString()}</span>
            <div class="text-[10px] text-text-muted flex gap-2 mt-1">
              <span>{props.statistics.tableIo.length} table{props.statistics.tableIo.length === 1 ? "" : "s"} touched</span>
            </div>
          </div>
        </div>

        {/* Table I/O Grid */}
        <div class="flex flex-col gap-2.5">
          <h3 class="text-s font-semibold text-text uppercase tracking-wider select-none">
            Table I/O Operations
          </h3>

          <Show
            when={props.statistics.tableIo.length > 0}
            fallback={
              <div class="p-6 text-center text-text-muted bg-surface/10 rounded-lg border border-border/10">
                No Table I/O operations reported by SQL Server.
              </div>
            }
          >
            <div class="border border-border/20 rounded-lg overflow-x-auto overflow-y-hidden bg-surface-table">
              <table class="w-full min-w-[860px] text-left border-collapse text-s">
                <thead>
                  <tr class="bg-surface-header text-text-muted/80 uppercase font-semibold text-3xs border-b border-border/20">
                    <th class="p-2.5 pl-4">Table Name</th>
                    <th class="p-2.5 text-right">Scan Count</th>
                    <th class="p-2.5 text-right">Logical Reads</th>
                    <th class="p-2.5 text-right">Physical Reads</th>
                    <th class="p-2.5 text-right">Read-Ahead</th>
                    <th class="p-2.5 text-right">LOB Logical</th>
                    <th class="p-2.5 text-right">LOB Physical</th>
                    <th class="p-2.5 text-right pr-4">LOB Read-Ahead</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={props.statistics.tableIo}>
                    {(io) => (
                      <tr class="border-t border-border/10 hover:bg-surface-hover transition-colors font-mono">
                        <td class="p-2.5 pl-4 font-sans font-medium text-text max-w-[220px] truncate" title={io.tableName}>
                          {io.tableName}
                        </td>
                        <td class="p-2.5 text-right">{io.scanCount.toLocaleString()}</td>
                        <td class="p-2.5 text-right font-semibold text-text">{io.logicalReads.toLocaleString()}</td>
                        <td class="p-2.5 text-right">{io.physicalReads.toLocaleString()}</td>
                        <td class="p-2.5 text-right">{io.readAheadReads.toLocaleString()}</td>
                        <td class="p-2.5 text-right">{io.lobLogicalReads.toLocaleString()}</td>
                        <td class="p-2.5 text-right">{io.lobPhysicalReads.toLocaleString()}</td>
                        <td class="p-2.5 text-right pr-4">{io.lobReadAheadReads.toLocaleString()}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <p class="text-[10px] text-text-muted/60 leading-normal pl-1">
              SQL Server STATISTICS IO/TIME values. Logical reads are page requests satisfied from the buffer cache; physical reads are pages read from disk.
            </p>
          </Show>
        </div>
      </div>

      <div class="flex justify-end gap-3 p-6 border-t border-border flex-shrink-0 bg-transparent">
        <button
          type="button"
          onClick={props.onClose}
          class="btn btn-secondary px-6 py-1.5"
        >
          Close
        </button>
      </div>
    </DialogShell>
  );
}
