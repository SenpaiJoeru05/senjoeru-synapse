import { useEffect, useState } from 'react'
import {
  BookOpen, Search, StickyNote, FileText, ListTodo, Brain, GitCommit,
  Plus, Trash2, Pencil, X, Bookmark, ExternalLink,
} from 'lucide-react'
import { api } from '@/lib/api'

const KIND: Record<string, { icon: React.ElementType; cls: string; label: string }> = {
  note:   { icon: StickyNote, cls: 'text-amber-300',   label: 'note' },
  doc:    { icon: FileText,   cls: 'text-cyan-300',    label: 'doc' },
  task:   { icon: ListTodo,   cls: 'text-primary',     label: 'task' },
  memory: { icon: Brain,      cls: 'text-fuchsia-300', label: 'memory' },
  event:  { icon: GitCommit,  cls: 'text-emerald-300', label: 'event' },
}

export default function Knowledge() {
  const [notes, setNotes] = useState<any[]>([])
  const [docs, setDocs] = useState<any[]>([])
  const [bookmarks, setBookmarks] = useState<any[]>([])

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[] | null>(null)
  const [engine, setEngine] = useState('')

  // note editor
  const [editId, setEditId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('note')

  // bookmark form
  const [bmLabel, setBmLabel] = useState('')
  const [bmUrl, setBmUrl] = useState('')

  const reload = () => {
    api.getNotes().then((r) => setNotes(r.notes ?? [])).catch(() => {})
    api.getDocs().then((r) => setDocs(r.docs ?? [])).catch(() => {})
    api.getBookmarks().then((r) => setBookmarks(r.bookmarks ?? [])).catch(() => {})
  }
  useEffect(reload, [])

  const runSearch = () => {
    if (!query.trim()) { setResults(null); return }
    api.search(query.trim())
      .then((r) => { setResults(r.results ?? []); setEngine(r.engine ?? '') })
      .catch(() => setResults([]))
  }

  const resetNote = () => { setEditId(null); setTitle(''); setBody(''); setCategory('note') }
  const saveNote = async () => {
    if (!title.trim()) return
    const data = { title, body, category }
    if (editId != null) await api.updateNote(editId, data)
    else await api.createNote(data)
    resetNote(); reload()
  }
  const editNote = (n: any) => { setEditId(n.id); setTitle(n.title); setBody(n.body || ''); setCategory(n.category || 'note') }
  const removeNote = async (id: number) => { await api.deleteNote(id); if (editId === id) resetNote(); reload() }

  const addBookmark = async () => {
    if (!bmLabel.trim()) return
    await api.createBookmark({ label: bmLabel, url: bmUrl }); setBmLabel(''); setBmUrl(''); reload()
  }
  const removeBookmark = async (id: number) => { await api.deleteBookmark(id); reload() }

  const docsByRepo: Record<string, any[]> = {}
  for (const d of docs) (docsByRepo[d.repo] ??= []).push(d)

  return (
    <div className="p-8 w-full">
      <div className="mb-5">
        <h1 className="text-3xl font-bold neon-text flex items-center gap-2">
          <BookOpen className="w-7 h-7 text-primary" /> Knowledge
        </h1>
        <p className="text-gray-400 mt-1 text-sm">
          Your engineering memory · {notes.length} notes · {docs.length} docs indexed · keyword search (local, no AI)
        </p>
      </div>

      {/* ── Search ── */}
      <div className="glass-card mb-5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="Search notes, docs, tasks, agent memory, history…"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface2 border border-white/10 focus:border-primary focus:outline-none text-sm"
            />
          </div>
          <button onClick={runSearch} className="px-4 py-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 text-sm">Search</button>
          {results != null && (
            <button onClick={() => { setQuery(''); setResults(null) }} className="px-3 py-2 rounded-lg bg-surface2 text-gray-400 hover:text-white text-sm">Clear</button>
          )}
        </div>

        {results != null && (
          <div className="mt-3">
            <p className="text-[11px] text-gray-600 mb-2">{results.length} results · engine: {engine}</p>
            {results.length === 0 ? (
              <p className="text-sm text-gray-500 py-3 text-center">No matches.</p>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto scrollbar-hide">
                {results.map((r, i) => {
                  const k = KIND[r.kind] ?? KIND.note
                  const Icon = k.icon
                  return (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-surface2">
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${k.cls}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{r.title}</p>
                        {r.snippet && <p className="text-[11px] text-gray-500 line-clamp-1">{r.snippet}</p>}
                      </div>
                      <span className="text-[10px] text-gray-600 shrink-0">{k.label}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Notes ── */}
        <div className="glass-card">
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2"><StickyNote className="w-5 h-5 text-amber-300" /> Notes & Decisions</h2>
          <div className="space-y-2 mb-4">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title"
              className="w-full px-3 py-2 rounded-lg bg-surface2 border border-white/10 focus:border-primary focus:outline-none text-sm" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Body / decision / context…" rows={3}
              className="w-full px-3 py-2 rounded-lg bg-surface2 border border-white/10 focus:border-primary focus:outline-none text-sm resize-y" />
            <div className="flex items-center gap-2">
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="px-3 py-2 rounded-lg bg-surface2 border border-white/10 text-sm">
                <option value="note">note</option>
                <option value="decision">decision</option>
                <option value="adr">ADR</option>
                <option value="gotcha">gotcha</option>
              </select>
              <button onClick={saveNote} disabled={!title.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 text-sm disabled:opacity-40">
                {editId != null ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                {editId != null ? 'Update' : 'Add'}
              </button>
              {editId != null && (
                <button onClick={resetNote} className="p-2 rounded-lg bg-surface2 text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
              )}
            </div>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-hide">
            {notes.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No notes yet — capture a decision above.</p>
            ) : notes.map((n) => (
              <div key={n.id} className="p-3 rounded-lg bg-surface2 group">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{n.title}</p>
                    {n.body && <p className="text-xs text-gray-400 line-clamp-2 mt-0.5">{n.body}</p>}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary mt-1 inline-block">{n.category}</span>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button onClick={() => editNote(n)} className="p-1 text-gray-500 hover:text-white"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => removeNote(n.id)} className="p-1 text-gray-500 hover:text-error"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Docs + Bookmarks ── */}
        <div className="space-y-5">
          <div className="glass-card">
            <h2 className="text-lg font-bold mb-3 flex items-center gap-2"><FileText className="w-5 h-5 text-cyan-300" /> Indexed docs <span className="ml-auto text-sm text-gray-500">{docs.length}</span></h2>
            {docs.length === 0 ? (
              <p className="text-sm text-gray-500">No docs indexed. Add repos in Settings, then reindex.</p>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto scrollbar-hide">
                {Object.entries(docsByRepo).map(([repo, list]) => (
                  <div key={repo}>
                    <p className="text-[11px] font-mono text-gray-500 mb-1">{repo} · {list.length}</p>
                    <div className="space-y-1">
                      {list.slice(0, 40).map((d) => (
                        <div key={d.id} className="flex items-center gap-2 p-1.5 rounded bg-surface2">
                          <FileText className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                          <span className="text-xs truncate flex-1">{d.title}</span>
                          <span className="text-[10px] text-gray-600 font-mono truncate max-w-[40%]">{d.rel_path}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass-card">
            <h2 className="text-lg font-bold mb-3 flex items-center gap-2"><Bookmark className="w-5 h-5 text-primary" /> Bookmarks</h2>
            <div className="flex gap-2 mb-3">
              <input value={bmLabel} onChange={(e) => setBmLabel(e.target.value)} placeholder="Label"
                className="flex-1 px-3 py-2 rounded-lg bg-surface2 border border-white/10 focus:border-primary focus:outline-none text-sm" />
              <input value={bmUrl} onChange={(e) => setBmUrl(e.target.value)} placeholder="URL (optional)"
                className="flex-1 px-3 py-2 rounded-lg bg-surface2 border border-white/10 focus:border-primary focus:outline-none text-sm" />
              <button onClick={addBookmark} disabled={!bmLabel.trim()} className="px-3 py-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 text-sm disabled:opacity-40"><Plus className="w-4 h-4" /></button>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-hide">
              {bookmarks.length === 0 ? (
                <p className="text-sm text-gray-500">No bookmarks.</p>
              ) : bookmarks.map((b) => (
                <div key={b.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface2 group">
                  <Bookmark className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-sm truncate flex-1">{b.label}</span>
                  {b.url && <a href={b.url} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-white"><ExternalLink className="w-3.5 h-3.5" /></a>}
                  <button onClick={() => removeBookmark(b.id)} className="text-gray-600 hover:text-error opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
