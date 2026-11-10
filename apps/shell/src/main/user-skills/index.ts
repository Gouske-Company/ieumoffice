/**
 * The person's skills in the shell's main process: the service (list, states,
 * writes to the app's skills folder, imports, updates, export, the AI's
 * reads), its IPC channels, and what the agent session takes.
 */
export { builtinSkillsDirFor } from './builtin-dir'
export {
  AI_SKILL_FILE_MAX_BYTES,
  createUserSkillsService,
  type AgentEnabledSkill,
  type UserSkillsService,
  type UserSkillsServiceDeps,
} from './user-skills-service'
export {
  DROPPED_SKILLS_MAX,
  registerUserSkillsIpc,
  type DroppedSkillSource,
  type UserSkillsIpc,
  type UserSkillsIpcDeps,
} from './user-skills-ipc'
export {
  copyFileNameOf,
  createTemplateTabs,
  type CopyTabContents,
  type OpenedCopyTab,
  type PreviewOwner,
  type TemplateCopy,
  type TemplateTabs,
  type TemplateTabsDeps,
} from './template-tabs'
export { registerTemplateTabsIpc } from './template-tabs-ipc'
