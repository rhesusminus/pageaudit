// URLs given as positional arguments.
export const fromArgs = (values) => values.map((value) => ({ value, source: 'argument' }))
