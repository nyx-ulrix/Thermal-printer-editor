import { layoutGroup, wrapSiblingsAsGroup } from './groupLayout'
import { offsetByLocal } from './preview'
import type { GroupElement, InputElement, LabelElement } from './types'

export function isGroup(element: LabelElement): element is GroupElement {
  return element.type === 'group'
}

export function walkElements(elements: LabelElement[]): LabelElement[] {
  const out: LabelElement[] = []
  for (const element of elements) {
    out.push(element)
    if (element.type === 'group') out.push(...walkElements(element.children))
  }
  return out
}

export function findElement(elements: LabelElement[], id: string): LabelElement | null {
  for (const element of elements) {
    if (element.id === id) return element
    if (element.type === 'group') {
      const nested = findElement(element.children, id)
      if (nested) return nested
    }
  }
  return null
}

/** Root-to-leaf ids, including `id` itself. */
export function ancestorPath(elements: LabelElement[], id: string): string[] {
  const path: string[] = []
  let current: string | null = id
  while (current) {
    path.unshift(current)
    current = parentGroupOf(elements, current)?.id ?? null
  }
  return path
}

export function isDescendantOf(elements: LabelElement[], id: string, ancestorId: string): boolean {
  if (id === ancestorId) return false
  return ancestorPath(elements, id).includes(ancestorId)
}

/**
 * Sibling ids that a Group command should wrap. Nested picks lift to a common parent,
 * so two groups, or a group plus other elements, become one nested group.
 */
export function groupingSiblingIds(elements: LabelElement[], ids: string[]): string[] {
  const existing = [...new Set(ids)].filter((id) => findElement(elements, id))
  const roots = existing.filter(
    (id) => !existing.some((other) => other !== id && isDescendantOf(elements, id, other))
  )
  if (roots.length < 2) return []

  const paths = roots.map((id) => ancestorPath(elements, id))
  let commonLen = 0
  const minLen = Math.min(...paths.map((path) => path.length))
  while (commonLen < minLen && paths.every((path) => path[commonLen] === paths[0][commonLen])) {
    commonLen += 1
  }

  const siblingIds: string[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    const siblingId = path[commonLen]
    if (!siblingId || seen.has(siblingId)) continue
    seen.add(siblingId)
    siblingIds.push(siblingId)
  }
  return siblingIds.length >= 2 ? siblingIds : []
}

export function groupSelected(
  elements: LabelElement[],
  ids: string[],
  newId: string
): { elements: LabelElement[]; groupId: string } | null {
  const siblingIds = groupingSiblingIds(elements, ids)
  if (siblingIds.length < 2) return null
  const parent = parentGroupOf(elements, siblingIds[0])
  const list = parent ? parent.children : elements
  const wrapped = wrapSiblingsAsGroup(list, siblingIds, newId)
  if (!wrapped) return null
  if (!parent) return wrapped
  return {
    groupId: wrapped.groupId,
    elements: updateById(elements, parent.id, (element) =>
      element.type === 'group' ? layoutGroup({ ...element, children: wrapped.elements }) : element
    )
  }
}

export function parentGroupOf(elements: LabelElement[], id: string): GroupElement | null {
  for (const element of elements) {
    if (element.type !== 'group') continue
    if (element.children.some((child) => child.id === id)) return element
    const nested = parentGroupOf(element.children, id)
    if (nested) return nested
  }
  return null
}

/** The group to move when a nested child is dragged. */
export function moveRootOf(elements: LabelElement[], id: string): LabelElement | null {
  const element = findElement(elements, id)
  if (!element) return null
  const parent = parentGroupOf(elements, id)
  return parent ?? element
}

/** Element in label space, with nested group transforms applied. */
export function absoluteOf(elements: LabelElement[], id: string): LabelElement | null {
  function visit(
    items: LabelElement[],
    originX: number,
    originY: number,
    originRotation: number
  ): LabelElement | null {
    for (const element of items) {
      const origin = offsetByLocal(originX, originY, originRotation, element.xMm, element.yMm)
      const rotation = originRotation + element.rotation
      if (element.id === id) {
        return { ...element, xMm: origin.xMm, yMm: origin.yMm, rotation }
      }
      if (element.type === 'group') {
        const nested = visit(element.children, origin.xMm, origin.yMm, rotation)
        if (nested) return nested
      }
    }
    return null
  }

  return visit(elements, 0, 0, 0)
}

export function updateById(
  elements: LabelElement[],
  id: string,
  updater: (element: LabelElement) => LabelElement
): LabelElement[] {
  return elements.map((element) => {
    if (element.id === id) return updater(element)
    if (element.type === 'group') {
      return { ...element, children: updateById(element.children, id, updater) }
    }
    return element
  })
}

export function removeById(elements: LabelElement[], id: string): LabelElement[] {
  return elements
    .filter((element) => element.id !== id)
    .map((element) =>
      element.type === 'group' ? { ...element, children: removeById(element.children, id) } : element
    )
}

function withLaidOutGroups(elements: LabelElement[]): LabelElement[] {
  return elements.map((element) => {
    if (element.type !== 'group') return element
    return layoutGroup({ ...element, children: withLaidOutGroups(element.children) })
  })
}

/** Applies a patch, then reflows any parent group so gap and alignment stay honest. */
export function patchElement(
  elements: LabelElement[],
  id: string,
  patch: Partial<LabelElement>
): LabelElement[] {
  const next = updateById(elements, id, (element) => {
    const merged = { ...element, ...patch } as LabelElement
    return merged.type === 'group' ? layoutGroup(merged) : merged
  })
  const parent = parentGroupOf(next, id)
  if (!parent) return withLaidOutGroups(next)
  return updateById(next, parent.id, (element) =>
    element.type === 'group' ? layoutGroup(element) : element
  )
}

export function cloneElement(element: LabelElement, newId: () => string): LabelElement {
  const copy = { ...element, id: newId() } as LabelElement
  if (copy.type === 'group') {
    return {
      ...copy,
      children: copy.children.map((child) => cloneElement(child, newId))
    }
  }
  return copy
}

export function moveElementAmongSiblings(
  elements: LabelElement[],
  movedId: string,
  targetId: string,
  place: 'before' | 'after'
): LabelElement[] {
  if (movedId === targetId) return elements
  if (isDescendantOf(elements, targetId, movedId)) return elements

  const movedParent = parentGroupOf(elements, movedId)
  const targetParent = parentGroupOf(elements, targetId)
  if (movedParent?.id !== targetParent?.id) return elements

  const list = movedParent ? movedParent.children : elements
  const moved = list.find((element) => element.id === movedId)
  if (!moved) return elements

  const without = list.filter((element) => element.id !== movedId)
  const targetIndex = without.findIndex((element) => element.id === targetId)
  if (targetIndex < 0) return elements

  const insertAt = place === 'before' ? targetIndex : targetIndex + 1
  const nextList = [...without.slice(0, insertAt), moved, ...without.slice(insertAt)]
  if (!movedParent) return nextList
  return updateById(elements, movedParent.id, (element) =>
    element.type === 'group' ? layoutGroup({ ...element, children: nextList }) : element
  )
}

export function assignPrintOrder(elements: LabelElement[], orderedIds: string[]): LabelElement[] {
  const rank = new Map(orderedIds.map((id, index) => [id, index]))
  function visit(items: LabelElement[]): LabelElement[] {
    return items.map((element) => {
      if (element.type === 'input') {
        const order = rank.get(element.id)
        if (order != null) return { ...element, printOrder: order }
      }
      if (element.type === 'group') {
        return { ...element, children: visit(element.children) }
      }
      return element
    })
  }
  return visit(elements)
}

export function layerById(
  elements: LabelElement[],
  id: string,
  position: 'front' | 'back'
): LabelElement[] {
  const parent = parentGroupOf(elements, id)
  const list = parent ? parent.children : elements
  const target = list.find((element) => element.id === id)
  if (!target) return elements
  const rest = list.filter((element) => element.id !== id)
  const nextList = position === 'front' ? [...rest, target] : [target, ...rest]
  if (!parent) return nextList
  return updateById(elements, parent.id, (element) =>
    element.type === 'group' ? layoutGroup({ ...element, children: nextList }) : element
  )
}

/**
 * Turns nested groups into absolutely placed print elements. Groups themselves do not print.
 */
export function flattenGroups(elements: LabelElement[]): Exclude<LabelElement, GroupElement>[] {
  const out: Exclude<LabelElement, GroupElement>[] = []

  function visit(
    items: LabelElement[],
    originX: number,
    originY: number,
    originRotation: number
  ) {
    for (const element of items) {
      const origin = offsetByLocal(originX, originY, originRotation, element.xMm, element.yMm)
      const rotation = originRotation + element.rotation
      if (element.type === 'group') {
        visit(element.children, origin.xMm, origin.yMm, rotation)
        continue
      }
      out.push({ ...element, xMm: origin.xMm, yMm: origin.yMm, rotation } as Exclude<
        LabelElement,
        GroupElement
      >)
    }
  }

  visit(withLaidOutGroups(elements), 0, 0, 0)
  return out
}

export function inputsIn(elements: LabelElement[]): InputElement[] {
  return walkElements(elements).filter((element): element is InputElement => element.type === 'input')
}

export function isImageLike(element: LabelElement): boolean {
  return element.type === 'image' || (element.type === 'input' && element.contentType === 'image')
}

export function collectImages(elements: LabelElement[]): LabelElement[] {
  return walkElements(elements).filter(isImageLike)
}

export function collectTextInputs(elements: LabelElement[]): InputElement[] {
  return walkElements(elements).filter(
    (element): element is InputElement => element.type === 'input' && element.contentType === 'text'
  )
}
