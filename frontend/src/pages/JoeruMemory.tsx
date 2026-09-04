import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Brain, Pencil, Trash2, Save, X, Link2, Search, CircleSlash, Loader2, Plus,
} from 'lucide-react'
import { api } from '@/lib/api'
import Markdown from '@/components/Markdown'

interface Memory {
  folder: string
  slug: string
  type: string
  name: string
  description: string
  created: string | null
  updated: number
  body: string
  links: string[]
}

const FOLDERS = [
  { key: 'preferences', label: 'Preferences', hint: 'How you want him to work', tone: 'text-indigo-300' },
  { key: 'decisions', label: 'Decisions', hint: 'Choices made, and why', tone: 'text-violet-300' },
  { key: 'facts', label: 'Facts', hint: "Things he couldn't read from the code", tone: 'text-sky-300' },
  { key: 'corrections', label: 'Corrections', hint: 'Where he got it wrong', tone: 'text-amber-300' },
]

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

export default function JoeruMemory() {
  const [data, setData] = useState<any>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState({ description: '', body: '' })
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState<string | null>(null)
  const [newSlug, setNewSlug] = useState('')

  async function load() {
    try { setData(await api.joeruMemory()) } catch { setData({ available: false }) }
  }
  useEffect(() => { load() }, [])

  const memories: Memory[] = data?.memories ?? []

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return memories
    return memories.filter(m =>
      m.slug.includes(q) ||
      m.description.toLowerCase().includes(q) ||
      m.body.toLowerCase().includes(q))
  }, [memories, query])

  const key = (m: Memory) => `${m.folder}/${m.slug}`

  function startEdit(m: Memory) {
    setEditing(key(m))
    setDraft({ description: m.description, body: m.body })
  }

  async function save(folder: string, slug: string) {
    if (!draft.body.trim()) return
    setBusy(true)
    try {
      await api.joeruSaveMemory(folder, slug, draft)
      setEditing(null); setCreating(null); setNewSlug('')
      await load()
    } finally { setBusy(false) }
  }

  async function remove(m: Memory) {
    if (!confirm(`Delete "${m.slug}"? Joeru will forget this.`)) return
    setBusy(true)
    try { await api.joeruDeleteMemory(m.folder, m.slug); await load() }
    finally { setBusy(false) }
  }

  if (data && data.available === false) {
    return (
      <div className="glass-card !p-10 text-center">
        <CircleSlash className="w-8 h-8 mx-auto mb-3 text-gray-600" />
        <p className="font-medium">No memory directory</p>
        <p className="text-sm text-gray-500 mt-1">
          Expected <code className="text-gray-400">joeru-kit/memory</code> next to this repo.
        </p>
        <p className="text-[11px] text-gray-600 mt-3">
          Set <span className="text-gray-500">joeruKitDir</span> in config, or
          <span className="text-gray-500"> SYNAPSE_JOERU_KIT</span>, if it lives elsewhere.
        </p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="glass-card !p-10 text-center text-gray-500 text-sm">
        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Reading memory…
      </div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Brain className="w-4 h-4 text-indigo-400" />
          <span className="tabular-nums">{memories.length}</span> memories
        </div>
        <div className="relative ml-auto">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search memory…"
            className="pl-8 pr-3 py-1.5 text-sm rounded-lg bg-white/[0.03] border border-white/10
                       placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50 w-56"
          />
        </div>
      </div>

      {FOLDERS.map(({ key: folder, label, hint, tone }) => {
        const items = filtered.filter(m => m.folder === folder)
        const isCreating = creating === folder
        if (!items.length && !isCreating && query) return null

        return (
          <div key={folder} className="glass-card !p-5">
            <div className="flex items-center gap-2 mb-1">
              <h2 className={`font-bold ${tone}`}>{label}</h2>
              <span className="text-[11px] text-gray-600 tabular-nums">{items.length}</span>
              <button
                onClick={() => { setCreating(isCreating ? null : folder); setNewSlug(''); setDraft({ description: '', body: '' }) }}
                className="ml-auto flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 transition-colors">
                <Plus className="w-3 h-3" /> add
              </button>
            </div>
            <p className="text-[11px] text-gray-600 mb-3">{hint}</p>

            {isCreating && (
              <div className="mb-3 p-3 rounded-xl bg-white/[0.03] border border-indigo-500/25 space-y-2">
                <input
                  value={newSlug}
                  onChange={e => setNewSlug(e.target.value)}
                  placeholder="short-name-for-this-memory"
                  className="w-full px-3 py-1.5 text-sm rounded-lg bg-black/30 border border-white/10
                             placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50"
                />
                <input
                  value={draft.description}
                  onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                  placeholder="One line — this is what he matches on during recall"
                  className="w-full px-3 py-1.5 text-sm rounded-lg bg-black/30 border border-white/10
                             placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50"
                />
                <textarea
                  value={draft.body}
                  onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
                  rows={4}
                  placeholder="The fact itself. Link others with [[their-slug]]."
                  className="w-full px-3 py-2 text-sm rounded-lg bg-black/30 border border-white/10 resize-y
                             placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50"
                />
                <div className="flex items-center gap-2">
                  <button
                    disabled={!slugify(newSlug) || !draft.body.trim() || busy}
                    onClick={() => save(folder, slugify(newSlug))}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg
                               bg-indigo-500/20 border border-indigo-500/30 text-indigo-200
                               disabled:opacity-40 hover:bg-indigo-500/30 transition-colors">
                    <Save className="w-3 h-3" /> Save
                  </button>
                  <button onClick={() => setCreating(null)}
                    className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                  {slugify(newSlug) && (
                    <span className="ml-auto text-[10px] text-gray-600 font-mono">
                      {folder}/{slugify(newSlug)}.md
                    </span>
                  )}
                </div>
              </div>
            )}

            {items.length === 0 && !isCreating ? (
              <p className="text-sm text-gray-600">Nothing yet.</p>
            ) : (
              <div className="space-y-2">
                {items.map(m => {
                  const isEditing = editing === key(m)
                  return (
                    <div key={key(m)}
                      className="p-3 rounded-xl bg-white/[0.02] border border-white/5 group">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{m.slug}</span>
                            {m.created && (
                              <span className="text-[10px] text-gray-700">{m.created}</span>
                            )}
                            {m.links.length > 0 && (
                              <span className="flex items-center gap-1 text-[10px] text-gray-600">
                                <Link2 className="w-2.5 h-2.5" />{m.links.join(', ')}
                              </span>
                            )}
                          </div>
                          {!isEditing && m.description && (
                            <p className="text-[12px] text-gray-500 mt-0.5">{m.description}</p>
                          )}
                        </div>

                        {!isEditing && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <button onClick={() => startEdit(m)}
                              className="p-1 text-gray-600 hover:text-gray-300" title="Edit">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => remove(m)}
                              className="p-1 text-gray-600 hover:text-red-400" title="Delete">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="mt-2 space-y-2">
                          <input
                            value={draft.description}
                            onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                            placeholder="One-line description"
                            className="w-full px-3 py-1.5 text-sm rounded-lg bg-black/30 border border-white/10
                                       focus:outline-none focus:border-indigo-500/50"
                          />
                          <textarea
                            value={draft.body}
                            onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
                            rows={6}
                            className="w-full px-3 py-2 text-sm rounded-lg bg-black/30 border border-white/10 resize-y
                                       focus:outline-none focus:border-indigo-500/50 font-mono text-[12.5px]"
                          />
                          <div className="flex items-center gap-2">
                            <button disabled={busy} onClick={() => save(m.folder, m.slug)}
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg
                                         bg-indigo-500/20 border border-indigo-500/30 text-indigo-200
                                         disabled:opacity-40 hover:bg-indigo-500/30 transition-colors">
                              <Save className="w-3 h-3" /> Save
                            </button>
                            <button onClick={() => setEditing(null)}
                              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300">
                              <X className="w-3 h-3" /> Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 pt-2 border-t border-white/5">
                          <Markdown>{m.body}</Markdown>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </motion.div>
  )
}
