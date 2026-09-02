import { promises as fs } from 'fs'
import path from 'path'
import type { Project } from '../shared/types'

/** 「未分类」默认项目固定 id */
export const UNCATEGORIZED_ID = 'uncategorized'
export const UNCATEGORIZED_NAME = '未分类'

export function projectsPath(root: string): string {
  return path.join(root, 'projects.json')
}

export async function readProjects(root: string): Promise<Project[]> {
  try {
    const raw = await fs.readFile(projectsPath(root), 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data?.projects) ? (data.projects as Project[]) : []
  } catch {
    return []
  }
}

async function writeProjects(root: string, projects: Project[]): Promise<void> {
  await fs.mkdir(path.dirname(projectsPath(root)), { recursive: true })
  await fs.writeFile(projectsPath(root), JSON.stringify({ projects }, null, 2), 'utf-8')
}

/** 确保「未分类」默认项目存在，并返回 */
export async function ensureDefaultProject(root: string): Promise<Project> {
  const projects = await readProjects(root)
  let uncat = projects.find((p) => p.id === UNCATEGORIZED_ID)
  if (!uncat) {
    uncat = {
      id: UNCATEGORIZED_ID,
      name: UNCATEGORIZED_NAME,
      color: '#94a3b8',
      createdAt: new Date().toISOString()
    }
    projects.push(uncat)
    await writeProjects(root, projects)
  }
  return uncat
}

export async function listProjects(root: string): Promise<Project[]> {
  await ensureDefaultProject(root)
  const projects = await readProjects(root)
  return projects.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

export async function createProject(
  root: string,
  name: string,
  color: string
): Promise<Project | null> {
  const projects = await readProjects(root)
  const n = name.trim()
  if (!n || projects.some((p) => p.name === n)) return null
  const project: Project = { id: crypto.randomUUID(), name: n, color, createdAt: new Date().toISOString() }
  projects.push(project)
  await writeProjects(root, projects)
  return project
}

export async function renameProject(
  root: string,
  id: string,
  name: string
): Promise<Project | null> {
  if (id === UNCATEGORIZED_ID) return null // 默认项目不可重命名
  const projects = await readProjects(root)
  const p = projects.find((x) => x.id === id)
  if (!p) return null
  const n = name.trim()
  if (!n || projects.some((x) => x.id !== id && x.name === n)) return null
  p.name = n
  await writeProjects(root, projects)
  return p
}

export async function recolorProject(
  root: string,
  id: string,
  color: string
): Promise<Project | null> {
  const projects = await readProjects(root)
  const p = projects.find((x) => x.id === id)
  if (!p) return null
  p.color = color
  await writeProjects(root, projects)
  return p
}

export async function deleteProject(root: string, id: string): Promise<{ ok: boolean }> {
  if (id === UNCATEGORIZED_ID) return { ok: false } // 默认项目不可删除
  const projects = await readProjects(root)
  const next = projects.filter((p) => p.id !== id)
  if (next.length === projects.length) return { ok: false }
  await writeProjects(root, next)
  return { ok: true }
}
