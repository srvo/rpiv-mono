import { describe, expect, it } from "vitest";
import {
	buildResolveModel,
	ladderModels,
	loadTierPolicy,
	resolveTierModel,
} from "./tiers.js";

describe("tier policy", () => {
	it("resolves hyperresearch stages to host keys", () => {
		const policy = loadTierPolicy();
		expect(resolveTierModel(policy, "pi", "hyperresearch", "fetch")).toBe("haiku");
		expect(resolveTierModel(policy, "pi", "hyperresearch", "critic")).toBe("opus");
		expect(resolveTierModel(policy, "praxis", "hyperresearch", "saw")).toBe("claude-opus-5-5");
	});

	it("returns undefined for unknown stages and hosts (host default wins)", () => {
		const policy = loadTierPolicy();
		expect(resolveTierModel(policy, "pi", "hyperresearch", "nope")).toBeUndefined();
		expect(resolveTierModel(policy, "nohost", "hyperresearch", "fetch")).toBeUndefined();
	});

	it("builds a resolveModel that pins known stages only", () => {
		const policy = loadTierPolicy();
		const resolveModel = buildResolveModel(policy, "pi", "hyperresearch");
		expect(resolveModel({ workflow: "w", stage: "fetch", skill: "s" })).toEqual({
			model: "haiku",
		});
		expect(resolveModel({ workflow: "w", stage: "nope", skill: "s" })).toBeUndefined();
	});

	it("materializes the rpiv ladder without duplicates", () => {
		const policy = loadTierPolicy();
		expect(ladderModels(policy, "pi")).toEqual(["haiku", "sonnet", "opus"]);
	});

	it("loads the bundled default when no user override exists", () => {
		// Corrupt-override tolerance lives in loadJsonConfig (returns {} on
		// malformed JSON, covered in config.test.ts); the loader then spreads
		// {} over the default, which is exactly this path.
		const policy = loadTierPolicy();
		expect(resolveTierModel(policy, "pi", "hyperresearch", "fetch")).toBe("haiku");
	});

	it("a valid user override replaces only its own sections", () => {
		const base = loadTierPolicy();
		const merged = {
			...base,
			bindings: {
				...(base.bindings ?? {}),
				pi: { ...((base.bindings ?? {}).pi ?? {}), small: "custom-cheap" },
			},
		};
		expect(resolveTierModel(merged, "pi", "hyperresearch", "fetch")).toBe("custom-cheap");
		expect(resolveTierModel(merged, "pi", "hyperresearch", "critic")).toBe("opus");
	});
});
