import { useState, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'

/**
 * Markdown for model output — GFM so tables, task lists and strikethrough work,
 * which matters because agents reach for tables constantly.
 *
 * Every element is given an explicit dark-theme style. Without that the browser
 * defaults leak through (white table borders, blue links, serif headings) and
 * the reply stops looking like part of the app.
 */

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked — the code is still selectable */ }
  }

  return (
    <div className="relative group my-3 rounded-xl overflow-hidden border border-white/10 bg-black/40">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 bg-white/[0.02]">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">{lang || 'text'}</span>
        <button onClick={copy}
          className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors">
          {copied ? <><Check className="w-3 h-3 text-emerald-400" /> copied</> : <><Copy className="w-3 h-3" /> copy</>}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-[12.5px] leading-relaxed">
        <code className="font-mono text-gray-200">{code}</code>
      </pre>
    </div>
  )
}

function MarkdownBody({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed text-gray-200 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,

          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
          em: ({ children }) => <em className="italic text-gray-300">{children}</em>,
          del: ({ children }) => <del className="text-gray-500">{children}</del>,

          h1: ({ children }) => <h1 className="text-base font-bold text-white mt-4 mb-2 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-[15px] font-bold text-white mt-4 mb-2 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-gray-100 mt-3 mb-1.5 first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="text-sm font-semibold text-gray-300 mt-3 mb-1.5 first:mt-0">{children}</h4>,

          ul: ({ children }) => <ul className="my-2 space-y-1 list-disc pl-5 marker:text-gray-600">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 space-y-1 list-decimal pl-5 marker:text-gray-600">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,

          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer"
               className="text-indigo-300 underline decoration-indigo-400/40 hover:decoration-indigo-300 underline-offset-2">
              {children}
            </a>
          ),

          blockquote: ({ children }) => (
            <blockquote className="my-3 pl-3 border-l-2 border-indigo-500/40 text-gray-400 italic">
              {children}
            </blockquote>
          ),

          hr: () => <hr className="my-4 border-white/10" />,

          // Tables scroll inside their own box — a wide table must never make
          // the whole chat pane scroll sideways.
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-[13px] border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-white/[0.04]">{children}</thead>,
          th: ({ children }) => (
            <th className="text-left font-semibold text-gray-300 px-3 py-2 border-b border-white/10 whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 border-b border-white/5 text-gray-300 align-top">{children}</td>
          ),
          tr: ({ children }) => <tr className="hover:bg-white/[0.02]">{children}</tr>,

          code: ({ className, children, ...props }) => {
            const text = String(children).replace(/\n$/, '')
            const lang = /language-(\w+)/.exec(className || '')?.[1]

            // react-markdown gives fenced blocks a language class or a newline;
            // anything else is inline.
            const isBlock = Boolean(lang) || text.includes('\n')
            if (isBlock) return <CodeBlock code={text} lang={lang} />

            return (
              <code className="px-1.5 py-0.5 rounded bg-white/[0.07] text-[12.5px] font-mono text-indigo-200"
                    {...props}>
                {children}
              </code>
            )
          },

          // The wrapper is handled by CodeBlock; stop <pre> adding its own box.
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

// Replies never change once rendered, and re-parsing markdown on every keystroke
// in the composer is pure waste.
export default memo(MarkdownBody)
