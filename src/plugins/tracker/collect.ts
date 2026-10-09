import { moment, path as paths, type App, type Moment } from '../../api'

export interface TrackerSpec extends Record<string, unknown> {
  searchType: string
  searchTarget: string
  folder?: string
  dateFormat?: string
  dateFormatPrefix?: string
  dateFormatSuffix?: string
  startDate?: string
  endDate?: string
  datasetName?: string
}

/** One searched thing over time: a value for each day that has one. */
export interface Dataset {
  name: string
  /** `YYYY-MM-DD` -> value. */
  values: Map<string, number>
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A number from text: `7`, `7.5`, `1:30` (hours and minutes, as hours); anything else that is not empty counts as one. */
function toNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return raw
  if (typeof raw === 'boolean') return raw ? 1 : 0
  if (Array.isArray(raw)) return raw.length ? (raw.length === 1 ? (toNumber(raw[0]) ?? 1) : raw.length) : null
  const text = String(raw).trim()
  if (!text) return null
  if (/^-?\d+(?:[.,]\d+)?$/.test(text)) return Number(text.replace(',', '.'))
  const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (time) return Number(time[1]) + Number(time[2]) / 60 + Number(time[3] ?? 0) / 3600
  return 1
}

/** The notes of the block's folder, each with the day it stands for. */
function notesByDay(app: App, spec: TrackerSpec): { path: string; day: string }[] {
  const folder = String(spec.folder ?? '/').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const all = app.metadata.notes()
  let inFolder = folder ? all.filter((path) => path.startsWith(`${folder}/`)) : all
  // A folder moved deeper since the block was written is still found by its name.
  if (folder && !inFolder.length) inFolder = all.filter((path) => `/${path}`.includes(`/${folder}/`))
  const format = String(spec.dateFormat ?? 'YYYY-MM-DD')
  const prefix = String(spec.dateFormatPrefix ?? '')
  const suffix = String(spec.dateFormatSuffix ?? '')
  const out: { path: string; day: string }[] = []
  for (const path of inFolder) {
    let name = paths.stripExt(paths.basename(path))
    if (prefix && name.startsWith(prefix)) name = name.slice(prefix.length)
    if (suffix && name.endsWith(suffix)) name = name.slice(0, -suffix.length)
    const date = moment(name, format)
    // Only a name that is exactly a date: "2026-10" is a month's note, not a day's.
    if (date.isValid() && date.format(format) === name) out.push({ path, day: date.format('YYYY-MM-DD') })
  }
  return out
}

/** Reads the values a block asks for. One dataset per target (targets are separated by commas). */
export function collect(app: App, spec: TrackerSpec): Dataset[] {
  const type = String(spec.searchType ?? '').trim()
  // A task's text may contain commas, so a task search has one target.
  const targets = type.startsWith('task') ? [String(spec.searchTarget ?? '')] : String(spec.searchTarget ?? '').split(',').map((t) => t.trim()).filter(Boolean)
  if (!type || !targets.length) throw new Error('нужны searchType и searchTarget')
  const names = String(spec.datasetName ?? '').split(',').map((n) => n.trim())
  const notes = notesByDay(app, spec)
  const from = spec.startDate ? moment(String(spec.startDate)).format('YYYY-MM-DD') : ''
  const to = spec.endDate ? moment(String(spec.endDate)).format('YYYY-MM-DD') : '9999'

  return targets.map((target, i) => {
    const values = new Map<string, number>()
    const add = (day: string, value: number | null) => value !== null && values.set(day, (values.get(day) ?? 0) + value)
    for (const { path, day } of notes) {
      if (day < from || day > to) continue
      const text = app.metadata.text(path) ?? ''
      const meta = app.metadata.get(path)
      if (type === 'frontmatter') {
        // `a.b` reaches into nested properties.
        const value = target.split('.').reduce<unknown>((object, key) => (object && typeof object === 'object' ? (object as Record<string, unknown>)[key] : undefined), meta?.frontmatter)
        add(day, toNumber(value))
      } else if (type === 'dvField') {
        const field = new RegExp(`(?:^|[\\[(])\\s*(?:[-*+]\\s+(?:\\[.\\]\\s+)?)?${escape(target)}::[ \\t]*([^\\])\\n]*)`, 'gim')
        for (const m of text.matchAll(field)) add(day, toNumber(m[1]))
      } else if (type === 'tag') {
        const tag = target.replace(/^#/, '')
        // `#weight:72.5` carries a value; a bare `#walk` counts as one.
        for (const m of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_/])#${escape(tag)}(?::\\s*(-?[\\d.,:]+))?(?![\\p{L}\\p{N}_/-])`, 'gu'))) add(day, m[1] ? toNumber(m[1]) : 1)
        if (meta?.frontmatter && [meta.frontmatter.tags].flat().some((own) => String(own ?? '').replace(/^#/, '') === tag)) add(day, 1)
      } else if (type === 'wiki' || type === 'wiki.link' || type === 'wiki.display') {
        for (const link of meta?.links ?? []) if (link.target.toLowerCase() === target.toLowerCase()) add(day, 1)
      } else if (type === 'text') {
        // A group named `value` gives the number; without one, every match counts as one.
        for (const m of text.matchAll(new RegExp(target, 'gm'))) add(day, m.groups?.value !== undefined ? toNumber(m.groups.value) : 1)
      } else if (type.startsWith('task')) {
        const wanted = type === 'task.done' ? /[xX]/ : type === 'task.notdone' ? / / : /./
        for (const m of text.matchAll(/^\s*(?:[-*+]|\d+[.)])\s+\[(.)\]\s+(.*)$/gm)) if (wanted.test(m[1]) && m[2].includes(target)) add(day, 1)
      } else if (type === 'fileMeta') {
        const entry = app.vault.get(path)
        const body = text.replace(/^---[\s\S]*?\n---\n?/, '')
        const metaValues: Record<string, number | null> = {
          size: entry?.size ?? null,
          numWords: body.split(/\s+/).filter(Boolean).length,
          numChars: body.length,
          numSentences: body.split(/[.!?…]+\s/).filter((part) => part.trim()).length,
          cDate: entry ? entry.ctime : null,
          mDate: entry ? entry.mtime : null,
        }
        add(day, Object.hasOwn(metaValues, target) ? metaValues[target] : null)
      } else throw new Error(`searchType «${type}» не поддерживается; есть: frontmatter, dvField, tag, wiki, text, task, task.done, task.notdone, fileMeta`)
    }
    return { name: names[i] || target, values }
  })
}

/** Every day from the first value to the last (or between the block's dates). */
export function days(datasets: Dataset[], spec: TrackerSpec): string[] {
  const all = datasets.flatMap((dataset) => [...dataset.values.keys()]).sort()
  if (!all.length) return []
  const end = spec.endDate ? moment(String(spec.endDate)) : moment(all[all.length - 1])
  const out: string[] = []
  for (let day: Moment = spec.startDate ? moment(String(spec.startDate)) : moment(all[0]); !day.isAfter(end, 'day') && out.length < 5000; day = day.clone().add(1, 'day')) out.push(day.format('YYYY-MM-DD'))
  return out
}

/** The numbers that `{{name()}}` stands for in a summary. */
export function stats(dataset: Dataset, range: string[]): Record<string, number | string> {
  const present = range.filter((day) => dataset.values.has(day))
  const numbers = present.map((day) => dataset.values.get(day)!)
  const sum = numbers.reduce((a, b) => a + b, 0)
  const sorted = [...numbers].sort((a, b) => a - b)
  const average = numbers.length ? sum / numbers.length : 0
  let run = 0
  let maxStreak = 0
  let gap = 0
  let maxBreaks = 0
  for (const day of range) {
    if ((dataset.values.get(day) ?? 0) > 0) {
      run++
      gap = 0
    } else {
      gap++
      run = 0
    }
    maxStreak = Math.max(maxStreak, run)
    maxBreaks = Math.max(maxBreaks, gap)
  }
  // The streak that is still going: days in a row up to today, or up to yesterday if today has nothing yet.
  let current = 0
  const today = moment().format('YYYY-MM-DD')
  for (let day = moment(); current < 100_000; day = day.clone().subtract(1, 'day')) {
    const key = day.format('YYYY-MM-DD')
    if ((dataset.values.get(key) ?? 0) > 0) current++
    else if (key !== today) break
  }
  const extreme = (value: number) => present.find((day) => dataset.values.get(day) === value) ?? ''
  return {
    sum,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    average,
    median: sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2 : 0,
    variance: numbers.length ? numbers.reduce((a, b) => a + (b - average) ** 2, 0) / numbers.length : 0,
    numTargets: sum,
    numDays: range.length,
    numDaysHavingData: present.length,
    maxStreak,
    currentStreak: current,
    maxBreaks,
    startDate: range[0] ?? '',
    endDate: range[range.length - 1] ?? '',
    minDate: extreme(sorted[0]),
    maxDate: extreme(sorted[sorted.length - 1]),
  }
}
