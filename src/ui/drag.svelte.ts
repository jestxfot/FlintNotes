/**
 * What is being dragged into a sidebar: a widget (by id) or a note tab (by
 * path). Both sidebars watch it to show where it can go.
 */
export const drag = $state({ panel: null as string | null, note: null as string | null })
