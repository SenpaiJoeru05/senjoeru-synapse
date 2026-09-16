/**
 * Icon-name string (as the backend's shared/describe-tool-call.js emits it)
 * -> the actual Lucide component to render.
 *
 * A real shared module this time, unlike shared/describe-tool-call.js — that
 * one crosses into Node-only territory (fs, config reads) with no frontend
 * precedent for importing it, so it was deliberately re-implemented on the
 * frontend side rather than risk an unverified bundler interop. This file has
 * no such boundary: Team.tsx and AssistantStats.tsx are both already inside
 * the same Vite-bundled frontend tree, so there is no reason for a third copy
 * of the same eight-entry lookup.
 */
import {
  FileText, FilePlus, Pencil, Terminal, Search, Users, Globe, ListChecks, Activity,
} from 'lucide-react'
import type { ElementType } from 'react'

export const TOOL_ICON: Record<string, ElementType> = {
  'file-text': FileText,
  'file-plus': FilePlus,
  pencil: Pencil,
  terminal: Terminal,
  search: Search,
  users: Users,
  globe: Globe,
  'list-checks': ListChecks,
  activity: Activity,
}

export function toolIcon(name: string): ElementType {
  return TOOL_ICON[name] ?? Activity
}
