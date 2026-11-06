/**
 * Central model-tier policy reader.
 *
 * Tiers (`small` / `medium` / `large`) are cost bands shared by
 * hyperresearch orchestration and rpiv workflows; membership is Pareto-driven
 * (a model belongs where it meets the tier's measured quality bar at the
 * tier's cost). A stage maps to a tier, the tier resolves to a host-opaque
 * model key on the executing host — so the same map drives both systems while
 * each host keeps its own bindings (Pi accepts many providers; the headless
 * Claude-Code runner accepts anthropic keys only).
 *
 * Source: bundled `model-tiers.json`, overridden per top-level section by
 * `~/.config/rpiv/model-tiers.json` when that file parses. A hand-edited
 * override can never crash the caller: garbage falls back to the default.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configPath, loadJsonConfig } from "./config.js";

export const TIER_POLICY_NAME = "rpiv";
export const TIER_POLICY_FILE = "model-tiers.json";

export type TierName = "small" | "medium" | "large";
export type TierPolicy = {
	version?: number;
	bindings?: Record<string, Record<string, string>>;
	maps?: Record<string, Record<string, unknown>>;
	[key: string]: unknown;
};

const HERE = dirname(fileURLToPath(import.meta.url));

function bundledPolicy(): TierPolicy {
	const raw = readFileSync(join(HERE, TIER_POLICY_FILE), "utf-8");
	return JSON.parse(raw) as TierPolicy;
}

/** Load the effective policy: bundled default under a valid user override. */
export function loadTierPolicy(): TierPolicy {
	const base = bundledPolicy();
	const override = loadJsonConfig<TierPolicy>(configPath(TIER_POLICY_NAME, TIER_POLICY_FILE));
	if (!override || typeof override !== "object" || Array.isArray(override)) return base;
	return { ...base, ...override };
}

/**
 * Resolve one stage to its host model key — `undefined` means "host default",
 * matching WorkflowModels precedence (pin, then resolveModel, then default).
 */
export function resolveTierModel(
	policy: TierPolicy,
	host: string,
	system: string,
	stage: string,
): string | undefined {
	const map = policy.maps?.[system];
	const tier = typeof map?.[stage] === "string" ? (map[stage] as string) : undefined;
	if (!tier) return undefined;
	const binding = policy.bindings?.[host]?.[tier];
	return typeof binding === "string" && binding.length > 0 ? binding : undefined;
}

/**
 * Build a Workflow `resolveModel` from a stage map: each known stage returns
 * `{ model }`, unknown stages fall through to the host default.
 */
export function buildResolveModel(
	policy: TierPolicy,
	host: string,
	system: string,
): (id: { workflow: string; stage: string; skill: string }) => { model: string } | undefined {
	return ({ stage }) => {
		const model = resolveTierModel(policy, host, system, stage);
		return model ? { model } : undefined;
	};
}

/** Materialize the rpiv tier ladder to host model keys for `escalate.ladder`. */
export function ladderModels(policy: TierPolicy, host: string): string[] {
	const ladder = policy.maps?.rpiv?.ladder;
	if (!Array.isArray(ladder)) return [];
	const out: string[] = [];
	for (const tier of ladder) {
		const key = typeof tier === "string" ? policy.bindings?.[host]?.[tier] : undefined;
		if (typeof key === "string" && key.length > 0 && !out.includes(key)) out.push(key);
	}
	return out;
}
