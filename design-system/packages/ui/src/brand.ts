/** Opt-in BitFun identity and motion, separate from generic UI controls. */
export { BitFunSolidMark, BitFunAppIcon, type BitFunArtworkProps } from "./brand/BitFunArtwork";
export { BitFunMark, type BitFunMarkProps } from "./brand/BitFunMark";
export { BitFunBrandMotion, type BitFunBrandMotionProps } from "./brand/BitFunBrandMotion";
export { VoiceParticleLogo, type VoiceParticleLogoProps, type VoiceParticleAudio, type VoiceParticleAudioReader } from "./brand/VoiceParticleLogo";

export * from "./brand/subagent/subagentMotion";
export { createSubagentMotionPlayer, type SubagentMotionPlayer } from "./brand/subagent/subagentMotionPlayer";
export { useSubagentAvatarMotion } from "./brand/subagent/useSubagentAvatarMotion";
export { SubagentHatch, type SubagentHatchProps } from "./brand/subagent/SubagentHatch";
export type { SubagentHatchPhase } from "./brand/subagent/subagentHatchMotion";
