import {
    fail,
    ObjectNode,
    splitJsonPath,
    joinJsonPath,
    ScalarNode,
    IChildNodesMap,
    EMPTY_ARRAY,
    INode
} from "../../internal"

/**
 * @internal
 * @hidden
 */
export enum NodeLifeCycle {
    INITIALIZING, // setting up
    CREATED, // afterCreate has run
    FINALIZED, // afterAttach has run
    DETACHING, // being detached from the tree
    DEAD // no coming back from this one
}

/**
 * Common interface that represents a node instance.
 * @hidden
 */
export interface IStateTreeNode<C = any, S = any> {
    readonly $treenode?: any
    // fake, will never be present, just for typing
    // we use this weird trick to allow reference types to work
    readonly "!!types"?: [C, S] | [any, any]
}

type Omit<T, K> = Pick<T, Exclude<keyof T, K>>

/** @hidden */
export type RedefineIStateTreeNode<T, STN extends IAnyStateTreeNode> = T extends IAnyStateTreeNode
    ? Omit<T, "!!types"> & STN
    : T

/** @hidden */
export type ExtractNodeC<T> = T extends IStateTreeNode<infer C, any> ? C : never

/** @hidden */
export type ExtractNodeS<T> = T extends IStateTreeNode<any, infer S> ? S : never

/**
 * Represents any state tree node instance.
 * @hidden
 */
export interface IAnyStateTreeNode extends IStateTreeNode<any, any> {}

/**
 * Returns true if the given value is a node in a state tree.
 * More precisely, that is, if the value is an instance of a
 * `types.model`, `types.array` or `types.map`.
 *
 * @param value
 * @returns true if the value is a state tree node.
 */
export function isStateTreeNode<C = any, S = any>(value: any): value is IStateTreeNode<C, S> {
    return !!(value && value.$treenode)
}

/**
 * @internal
 * @hidden
 */
export function getStateTreeNode(value: IAnyStateTreeNode): ObjectNode {
    if (isStateTreeNode(value)) return value.$treenode!
    else throw fail(`Value ${value} is no MST Node`)
}

/**
 * @internal
 * @hidden
 */
export function getStateTreeNodeSafe(value: IAnyStateTreeNode): ObjectNode {
    return (value && value.$treenode) || null
}

/**
 * @internal
 * @hidden
 */
export function canAttachNode(value: any) {
    return (
        value &&
        typeof value === "object" &&
        !(value instanceof Date) &&
        !isStateTreeNode(value) &&
        !Object.isFrozen(value)
    )
}

/**
 * @internal
 * @hidden
 */
export function toJSON<S>(this: IStateTreeNode<any, S>): S {
    return getStateTreeNode(this).snapshot
}

const doubleDot = (_: any) => ".."

/**
 * @internal
 * @hidden
 */
export function getRelativePathBetweenNodes(base: ObjectNode, target: ObjectNode): string {
    // PRE condition target is (a child of) base!
    if (base.root !== target.root) {
        throw fail(
            `Cannot calculate relative path: objects '${base}' and '${target}' are not part of the same object tree`
        )
    }

    const baseParts = splitJsonPath(base.path)
    const targetParts = splitJsonPath(target.path)
    let common = 0
    for (; common < baseParts.length; common++) {
        if (baseParts[common] !== targetParts[common]) break
    }
    // TODO: assert that no targetParts paths are "..", "." or ""!
    return (
        baseParts
            .slice(common)
            .map(doubleDot)
            .join("/") + joinJsonPath(targetParts.slice(common))
    )
}

/**
 * @internal
 * @hidden
 */
export function resolveNodeByPath(
    base: ObjectNode,
    path: string,
    failIfResolveFails: boolean = true
): INode | undefined {
    return resolveNodeByPathParts(base, splitJsonPath(path), failIfResolveFails)
}

/**
 * @internal
 * @hidden
 */
export function resolveNodeByPathParts(
    base: ObjectNode,
    pathParts: string[],
    failIfResolveFails: boolean = true
): INode | undefined {
    let current: INode | null = base

    for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i]
        if (part === "..") {
            current = current!.parent
            if (current) continue // not everything has a parent
        } else if (part === ".") {
            continue
        } else if (current) {
            if (current instanceof ScalarNode) {
                // check if the value of a scalar resolves to a state tree node (e.g. references)
                // then we can continue resolving...
                try {
                    const value = current.value
                    if (isStateTreeNode(value)) {
                        current = getStateTreeNode(value)
                        // fall through
                    }
                } catch (e) {
                    if (!failIfResolveFails) {
                        return undefined
                    }
                    throw e
                }
            }
            if (current instanceof ObjectNode) {
                const subType = current.getChildType(part)
                if (subType) {
                    current = current.getChildNode(part)
                    if (current) continue
                }
            }
        }
        if (failIfResolveFails)
            throw fail(
                `Could not resolve '${part}' in path '${joinJsonPath(pathParts.slice(0, i)) ||
                    "/"}' while resolving '${joinJsonPath(pathParts)}'`
            )
        else return undefined
    }
    return current!
}

/**
 * @internal
 * @hidden
 */
export function convertChildNodesToArray(childNodes: IChildNodesMap | null): INode[] {
    if (!childNodes) return EMPTY_ARRAY as INode[]

    const keys = Object.keys(childNodes)
    if (!keys.length) return EMPTY_ARRAY as INode[]

    const result = new Array(keys.length) as INode[]
    keys.forEach((key, index) => {
        result[index] = childNodes![key]
    })
    return result
}
