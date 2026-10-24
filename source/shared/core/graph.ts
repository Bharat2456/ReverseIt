import type { Evidence, Graph, GraphNode } from './types';

/** Merge the partial graphs of many evidence records into one deduplicated architecture graph. */
export function mergeGraphs(evidence: Evidence[], maxNodes = 60): Graph {
  const byKey = new Map<string, GraphNode>();
  const alias = new Map<string, string>();
  const edges = new Map<string, { from: string; to: string; label?: string }>();
  for (const ev of evidence) {
    if (!ev.graph) continue;
    for (const n of ev.graph.nodes) {
      // Nodes with the same kind and label are the same part, even if two analyzers gave them different ids.
      const key = `${n.group}|${n.label.toLowerCase()}`;
      const o = byKey.get(key);
      if (!o) { byKey.set(key, { ...n }); alias.set(n.id, n.id); }
      else { o.weight = Math.max(o.weight ?? 1, n.weight ?? 1); alias.set(n.id, o.id); }
    }
  }
  for (const ev of evidence) {
    if (!ev.graph) continue;
    for (const e of ev.graph.edges) {
      const from = alias.get(e.from) ?? e.from, to = alias.get(e.to) ?? e.to;
      if (from !== to) edges.set(`${from}>${to}>${e.label ?? ''}`, { ...e, from, to });
    }
  }
  let list = [...byKey.values()];
  if (list.length > maxNodes) {
    list.sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));
    list = list.slice(0, maxNodes);
  }
  const keep = new Set(list.map((n) => n.id));
  return { nodes: list, edges: [...edges.values()].filter((e) => keep.has(e.from) && keep.has(e.to)) };
}
