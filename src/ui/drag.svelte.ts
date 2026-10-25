/**
 * What is being dragged: a widget (by id) or a note tab (by path), which the
 * sidebars and the strips along the edges watch to show where it can go; or a
 * button of the frame (by id), which every strip watches.
 */
export const drag = $state({ panel: null as string | null, note: null as string | null, button: null as string | null })
