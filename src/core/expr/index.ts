/**
 * The expression language shared by bases and tables, compatible with the
 * syntax of Obsidian Bases: `price * 1.2`, `file.hasTag("book") && status != "done"`,
 * `(due - today()) / 86400000`, `tags.filter(value.startsWith("a")).length`.
 */
export { evaluate, type Fn, type Scope } from './evaluate'
export { ExprError, parse, type Node } from './parser'
export {
  compare,
  Duration,
  equal,
  FileRef,
  formatDate,
  isEmpty,
  isoDate,
  Link,
  parseDate,
  parseDuration,
  toText,
  truthy,
  typeOf,
  type FileInfo,
  type ValueType,
} from './values'
