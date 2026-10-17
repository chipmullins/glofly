import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CATEGORY_NAME_MAX,
  CONSTELLATION_COLORS,
  CONSTELLATION_DESCRIPTION_MAX,
  CONSTELLATION_NAME_MAX,
  CONSTELLATION_THEME,
  CONSTELLATION_TYPES,
  DEFAULT_LINK_LIFETIME,
  LINK_LIFETIMES,
  NEBULA_NAME_MAX,
  NEBULA_TOPIC_MAX,
  PERMISSIONS,
  ROLE_COLOR_CHOICES,
  ROLE_COLORS,
  ROLE_NAME_MAX,
  constellationLink,
  type ConstellationColor,
  type ConstellationPermission,
  type ConstellationType,
  type ConstellationVisibility,
  type LinkLifetime,
  type RoleColor
} from '@glofly/shared/constellations'
import type {
  ConstellationBan,
  ConstellationDetail,
  ConstellationLink,
  JoinRequest,
  ModerationEntry,
  PublicUser,
  SignedInUser
} from '../../../preload/api-types'
import { AvatarFace } from '../components/Avatar'
import { colorsFor } from '../lib/avatarColors'
import { api, can, outranks, topRole } from '../lib/constellations'
import { CloseIcon, ConstellationIcon } from './bits'
import { TagInput, VisibilityChoices } from './CreateJoin'
import type { SettingsPageName } from './ConstellationView'
import './Settings2.css'

// Constellation settings (Roles.dc.html, approved): a left menu (Overview, Nebulas & categories,
// Roles, Members, Invites, Moderation, Delete constellation). Roles: highest first with colors and
// counts; the selected role's name, color and permission checkboxes. The other pages follow its
// look. Each page shows only what your role lets you do; the server checks everything again.

type Detail =
  { ok: true; data: { constellation: ConstellationDetail } } | { ok: false; message: string }

const firstName = (u: PublicUser): string => u.displayName.trim().split(/\s+/)[0] || u.username

function Face({ person, size = 32 }: { person: PublicUser; size?: number }): React.JSX.Element {
  const [bg, fg] = colorsFor(person.id)
  return (
    <span
      className="cx-face"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.4)
      }}
    >
      <AvatarFace id={person.id} name={person.displayName} avatarVersion={person.avatarVersion} />
    </span>
  )
}

const ACTION_WORDS: Record<string, string> = {
  joined: 'joined',
  left: 'left',
  kicked: 'kicked',
  banned: 'banned',
  unbanned: 'unbanned',
  timed_out: 'timed out',
  timeout_removed: 'ended the time-out of',
  message_deleted: 'deleted a message by',
  roles_changed: 'changed the roles of',
  role_created: 'created a role',
  role_changed: 'changed a role',
  role_deleted: 'deleted a role',
  nebula_deleted: 'deleted a nebula',
  voice_muted: 'muted in voice',
  voice_unmuted: 'unmuted in voice',
  voice_disconnected: 'disconnected from voice',
  visibility_changed: 'changed who can join',
  request_approved: 'let in',
  request_denied: 'turned down',
  ownership_transferred: 'gave ownership to'
}

function moderationLine(e: ModerationEntry, meId: string): string {
  const who = (u: PublicUser | null): string =>
    u ? (u.id === meId ? 'you' : u.displayName) : 'someone'
  const actor = e.actor ? (e.actor.id === meId ? 'You' : e.actor.displayName) : 'Glofly'
  const verb = ACTION_WORDS[e.action] ?? e.action.replace(/_/g, ' ')
  const d = e.details ?? {}
  const extra =
    e.action === 'timed_out' && typeof d.length === 'string'
      ? ` for ${d.length}`
      : (e.action.startsWith('role_') || e.action === 'nebula_deleted') &&
          typeof d.name === 'string'
        ? ` “${d.name}”`
        : e.action.startsWith('voice_') && typeof d.nebula === 'string'
          ? ` in ${d.nebula}`
          : e.action === 'message_deleted' && typeof d.excerpt === 'string' && d.excerpt
            ? `: “${d.excerpt}”`
            : ''
  const target =
    e.action === 'joined' || e.action === 'left' || !e.target ? '' : ` ${who(e.target)}`
  const why =
    typeof d.reason === 'string' && d.reason && d.reason !== 'account_removed'
      ? ` · ${d.reason}`
      : ''
  return `${actor} ${verb}${target}${extra}${why}`
}

export default function ConstellationSettings({
  me,
  detail: c,
  initialPage,
  friends,
  onClose,
  onChanged,
  onDeleted,
  onProblem
}: {
  me: SignedInUser
  detail: ConstellationDetail
  initialPage: SettingsPageName
  /** Friends you could invite */
  friends: PublicUser[]
  onClose: () => void
  onChanged: (detail: ConstellationDetail) => void
  onDeleted: () => void
  onProblem: (message: string) => void
}): React.JSX.Element {
  const [page, setPage] = useState<SettingsPageName>(initialPage)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const [errorPage, setErrorPage] = useState(page)
  if (errorPage !== page) {
    setErrorPage(page)
    setError(null)
  }

  async function run(task: () => Promise<Detail>): Promise<boolean> {
    setBusy(true)
    setError(null)
    const r = await task()
    setBusy(false)
    if (!r.ok) {
      setError(r.message)
      return false
    }
    onChanged(r.data.constellation)
    return true
  }

  const modViewer = [
    'deleteMessages',
    'timeoutKick',
    'ban',
    'muteVoice',
    'manageRoles',
    'manageConstellation'
  ].some((p) => can(c, p as ConstellationPermission))
  const pages: { id: SettingsPageName; name: string; show: boolean }[] = [
    { id: 'overview', name: 'Overview', show: true },
    { id: 'nebulas', name: 'Nebulas & categories', show: true },
    { id: 'roles', name: 'Roles', show: true },
    { id: 'members', name: 'Members', show: true },
    { id: 'invites', name: 'Invites', show: true },
    { id: 'moderation', name: 'Moderation', show: modViewer }
  ]
  const title =
    page === 'delete' ? 'Delete constellation' : (pages.find((p) => p.id === page)?.name ?? '')

  return (
    <div
      className="cx-settings-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cx-set-title"
        className="cx-settings"
        ref={dialogRef}
      >
        <nav aria-label="Constellation settings" className="cx-settings-nav">
          <div className="cx-settings-name">
            <ConstellationIcon
              id={c.id}
              name={c.name}
              color={c.color}
              iconVersion={c.iconVersion}
              className="cx-settings-icon"
              style={
                c.color === 'ember' && !c.iconVersion
                  ? { background: '#1c1210', color: '#ffb347' }
                  : undefined
              }
            />
            <span>{c.name}</span>
          </div>
          {pages
            .filter((p) => p.show)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                className="cx-settings-tab"
                aria-current={page === p.id ? 'page' : undefined}
                onClick={() => setPage(p.id)}
              >
                {p.name}
                {p.id === 'members' && c.pendingRequests > 0 && (
                  <span className="cx-settings-count">{c.pendingRequests}</span>
                )}
              </button>
            ))}
          <span style={{ flex: 1 }} />
          {c.me.owner && (
            <button
              type="button"
              className="cx-settings-tab cx-settings-tab--danger"
              aria-current={page === 'delete' ? 'page' : undefined}
              onClick={() => setPage('delete')}
            >
              Delete constellation
            </button>
          )}
        </nav>
        <div className="cx-settings-main">
          <header className="cx-settings-head">
            <h1 id="cx-set-title">{title}</h1>
            {page === 'roles' && can(c, 'manageRoles') && (
              <button
                type="button"
                className="cx-create-role"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    api.addRole(c.id, {
                      name: 'New role',
                      color: 'green',
                      permissions: c.me.owner
                        ? ['invite']
                        : c.me.permissions.includes('invite')
                          ? ['invite']
                          : []
                    })
                  )
                }
              >
                Create role
              </button>
            )}
            <button
              type="button"
              className="cx-settings-close"
              aria-label="Close settings"
              onClick={onClose}
            >
              <CloseIcon size={20} />
            </button>
          </header>
          {error && <p className="cx-error cx-settings-error">{error}</p>}
          {page === 'overview' && <Overview c={c} busy={busy} run={run} onProblem={onProblem} />}
          {page === 'nebulas' && <NebulasPage c={c} busy={busy} run={run} />}
          {page === 'roles' && <RolesPage c={c} busy={busy} run={run} />}
          {page === 'members' && (
            <MembersPage c={c} me={me} busy={busy} run={run} onProblem={onProblem} />
          )}
          {page === 'invites' && <InvitesPage c={c} friends={friends} onProblem={onProblem} />}
          {page === 'moderation' && <ModerationPage c={c} me={me} />}
          {page === 'delete' && <DeletePage c={c} onDeleted={onDeleted} />}
        </div>
      </div>
    </div>
  )
}

type PageProps = {
  c: ConstellationDetail
  busy: boolean
  run: (task: () => Promise<Detail>) => Promise<boolean>
}

function Overview({
  c,
  busy,
  run,
  onProblem
}: PageProps & { onProblem: (m: string) => void }): React.JSX.Element {
  const editable = can(c, 'manageConstellation')
  const [name, setName] = useState(c.name)
  const [description, setDescription] = useState(c.description ?? '')
  const [visibility, setVisibility] = useState<ConstellationVisibility>(c.visibility)
  const [type, setType] = useState<ConstellationType | ''>(c.type ?? '')
  const [tags, setTags] = useState<string[]>(c.tags)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const dirty =
    name.trim() !== c.name ||
    (description.trim() || null) !== c.description ||
    visibility !== c.visibility ||
    (type || null) !== c.type ||
    tags.join(',') !== c.tags.join(',')

  async function save(): Promise<void> {
    const ok = await run(() =>
      api.update(c.id, {
        name: name.trim(),
        description: description.trim() || null,
        visibility,
        type: type || null,
        tags
      })
    )
    if (ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    }
  }

  async function pick(file: File | undefined): Promise<void> {
    if (!file) return
    const okTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!okTypes.includes(file.type) || file.size > 8 * 1024 * 1024) {
      onProblem('Pick a JPG, PNG, WebP or GIF picture up to 8 MB.')
      return
    }
    const r = await api.setIcon(c.id, await file.arrayBuffer(), file.type as 'image/png')
    if (!r.ok) onProblem(r.message)
  }

  return (
    <div className="cx-settings-body">
      <div className="cx-settings-row">
        <button
          type="button"
          className="cx-icon-pick cx-icon-pick--set"
          disabled={!editable}
          aria-label="Change the icon"
          onClick={() => fileRef.current?.click()}
        >
          <ConstellationIcon
            id={c.id}
            name={c.name}
            color={c.color}
            iconVersion={c.iconVersion}
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--glo-font-display)',
              fontWeight: 700,
              fontSize: 26
            }}
          />
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(e) => {
            void pick(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {editable && (
            <>
              <button type="button" className="cx-button" onClick={() => fileRef.current?.click()}>
                Change icon
              </button>
              {c.iconVersion && (
                <button
                  type="button"
                  className="cx-link-button cx-link-button--quiet"
                  onClick={() => void api.removeIcon(c.id)}
                >
                  Use initials instead
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <label className="cx-field">
        Name
        <input
          type="text"
          value={name}
          maxLength={CONSTELLATION_NAME_MAX}
          disabled={!editable}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <fieldset className="cx-fieldset">
        <legend>Color</legend>
        <div role="radiogroup" aria-label="Constellation color" className="cx-swatches">
          {CONSTELLATION_COLORS.map((color: ConstellationColor) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={c.color === color}
              aria-label={CONSTELLATION_THEME[color].name}
              disabled={!editable || busy}
              className="cx-swatch cx-swatch--banner"
              style={{
                background: CONSTELLATION_THEME[color].banner,
                boxShadow:
                  c.color === color
                    ? `0 0 0 2px var(--glo-surface), 0 0 0 4px ${CONSTELLATION_THEME[color].glow}`
                    : undefined
              }}
              onClick={() => void run(() => api.update(c.id, { color }))}
            >
              <span style={{ background: CONSTELLATION_THEME[color].glow }} />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="cx-fieldset">
        <legend>Who can join</legend>
        {editable ? (
          <VisibilityChoices value={visibility} onChange={setVisibility} />
        ) : (
          <p className="cx-settings-text">
            {visibility === 'invite'
              ? 'Invite only'
              : visibility === 'public'
                ? 'Public'
                : 'Public, approval needed'}
          </p>
        )}
      </fieldset>
      {visibility !== 'invite' && (
        <>
          <div style={{ display: 'flex', gap: 12 }}>
            <label className="cx-field" style={{ flex: '0 0 200px' }}>
              Kind
              <select
                value={type}
                disabled={!editable}
                onChange={(e) => setType(e.target.value as ConstellationType | '')}
              >
                <option value="">Pick one</option>
                {CONSTELLATION_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="cx-field">
              <span>Genre tags</span>
              {editable ? (
                <TagInput tags={tags} onChange={setTags} />
              ) : (
                <span className="cx-settings-text">
                  {tags.map((t) => `#${t}`).join(' ') || 'None'}
                </span>
              )}
            </div>
          </div>
        </>
      )}
      <label className="cx-field">
        Description
        <textarea
          value={description}
          maxLength={CONSTELLATION_DESCRIPTION_MAX}
          disabled={!editable}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      {editable && (
        <div className="cx-dialog-actions" style={{ justifyContent: 'flex-start' }}>
          <button
            type="button"
            className="cx-button cx-button--primary"
            disabled={!dirty || busy}
            onClick={() => void save()}
          >
            {saved ? 'Saved' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  )
}

function NebulasPage({ c, busy, run }: PageProps): React.JSX.Element {
  const editable = can(c, 'manageNebulas')
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<'text' | 'voice'>('text')
  const [newCategory, setNewCategory] = useState<string>(c.categories[0]?.id ?? '')
  const [catName, setCatName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ name: string; topic: string; readOnly: boolean }>({
    name: '',
    topic: '',
    readOnly: false
  })
  const [drag, setDrag] = useState<string | null>(null)
  const cats = [...c.categories].sort((a, b) => a.position - b.position)
  const ordered = [...c.nebulas].sort((a, b) => a.position - b.position)

  function layoutWith(move: {
    id: string
    categoryId: string | null
    before: string | null
  }): Promise<Detail> {
    const list = ordered.filter((n) => n.id !== move.id)
    const moving = ordered.find((n) => n.id === move.id)!
    const index = move.before ? list.findIndex((n) => n.id === move.before) : list.length
    list.splice(index < 0 ? list.length : index, 0, { ...moving, categoryId: move.categoryId })
    return api.layout(
      c.id,
      cats.map((x) => x.id),
      list.map((n) => ({ id: n.id, categoryId: n.categoryId }))
    )
  }
  function moveCategory(id: string, dir: -1 | 1): Promise<Detail> {
    const ids = cats.map((x) => x.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return Promise.resolve({ ok: true, data: { constellation: c } })
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    return api.layout(
      c.id,
      ids,
      ordered.map((n) => ({ id: n.id, categoryId: n.categoryId }))
    )
  }

  const groups: { id: string | null; name: string }[] = [
    { id: null, name: 'Not in a category' },
    ...cats.map((x) => ({ id: x.id, name: x.name }))
  ]

  return (
    <div className="cx-settings-body">
      {!editable && <p className="cx-settings-text">Your role can’t change nebulas here.</p>}
      {editable && (
        <form
          className="cx-settings-card"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!newName.trim()) return
            const ok = await run(() =>
              api.addNebula(c.id, { name: newName, kind: newKind, categoryId: newCategory || null })
            )
            if (ok) setNewName('')
          }}
        >
          <strong>New nebula</strong>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="cx-segment" role="radiogroup" aria-label="Kind of nebula">
              <button
                type="button"
                role="radio"
                aria-checked={newKind === 'text'}
                onClick={() => setNewKind('text')}
              >
                Text
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={newKind === 'voice'}
                onClick={() => setNewKind('voice')}
              >
                Voice
              </button>
            </div>
            <label className="cx-field" style={{ minWidth: 180 }}>
              Name
              <input
                type="text"
                value={newName}
                maxLength={NEBULA_NAME_MAX}
                placeholder={newKind === 'text' ? 'looking-for-group' : 'Campfire'}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
            <label className="cx-field" style={{ flex: '0 0 180px' }}>
              Category
              <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                <option value="">None</option>
                {cats.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="cx-button cx-button--primary"
              disabled={busy || !newName.trim()}
            >
              Create
            </button>
          </div>
        </form>
      )}
      {groups.map((g) => {
        const list = ordered.filter((n) =>
          g.id ? n.categoryId === g.id : !n.categoryId || !cats.some((x) => x.id === n.categoryId)
        )
        if (!g.id && !list.length && !editable) return null
        const cat = g.id ? cats.find((x) => x.id === g.id) : null
        return (
          <section
            key={g.id ?? 'none'}
            className="cx-settings-group"
            onDragOver={(e) => editable && drag && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (drag) void run(() => layoutWith({ id: drag, categoryId: g.id, before: null }))
              setDrag(null)
            }}
          >
            <div className="cx-settings-group-head">
              {cat && editable ? (
                <CategoryName
                  name={cat.name}
                  onSave={(name) => void run(() => api.renameCategory(c.id, cat.id, name))}
                />
              ) : (
                <h2>{g.name}</h2>
              )}
              {cat && editable && (
                <span className="cx-settings-group-actions">
                  <button
                    type="button"
                    aria-label={`Move ${cat.name} up`}
                    onClick={() => void run(() => moveCategory(cat.id, -1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${cat.name} down`}
                    onClick={() => void run(() => moveCategory(cat.id, 1))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${cat.name}`}
                    title="Delete category (its nebulas stay)"
                    onClick={() => void run(() => api.removeCategory(c.id, cat.id))}
                  >
                    <CloseIcon size={14} />
                  </button>
                </span>
              )}
            </div>
            {list.length === 0 && (
              <p className="cx-settings-text cx-settings-drop">Drag nebulas here</p>
            )}
            {list.map((n) => (
              <div
                key={n.id}
                className={
                  drag === n.id ? 'cx-settings-item cx-settings-item--drag' : 'cx-settings-item'
                }
                draggable={editable && editing !== n.id}
                onDragStart={() => setDrag(n.id)}
                onDragEnd={() => setDrag(null)}
                onDragOver={(e) => editable && drag && drag !== n.id && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (drag && drag !== n.id)
                    void run(() => layoutWith({ id: drag, categoryId: g.id, before: n.id }))
                  setDrag(null)
                }}
              >
                {editing === n.id ? (
                  <form
                    className="cx-settings-edit"
                    onSubmit={async (e) => {
                      e.preventDefault()
                      const ok = await run(() =>
                        api.updateNebula(c.id, n.id, {
                          name: draft.name,
                          topic: draft.topic.trim() || null,
                          readOnly: draft.readOnly
                        })
                      )
                      if (ok) setEditing(null)
                    }}
                  >
                    <input
                      type="text"
                      aria-label="Name"
                      value={draft.name}
                      maxLength={NEBULA_NAME_MAX}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                    <input
                      type="text"
                      aria-label="Topic"
                      placeholder="Topic (optional)"
                      value={draft.topic}
                      maxLength={NEBULA_TOPIC_MAX}
                      onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
                    />
                    {n.kind === 'text' && (
                      <label className="cx-check">
                        <input
                          type="checkbox"
                          checked={draft.readOnly}
                          onChange={(e) => setDraft({ ...draft, readOnly: e.target.checked })}
                        />
                        Announcements (only moderators post)
                      </label>
                    )}
                    <span style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="cx-button" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="cx-button cx-button--primary"
                        disabled={busy}
                      >
                        Save
                      </button>
                    </span>
                  </form>
                ) : (
                  <>
                    <span className="cx-settings-item-kind" aria-hidden="true">
                      {n.kind === 'text' ? '✦' : '🔊'}
                    </span>
                    <span className="cx-settings-item-text">
                      <strong>{n.name}</strong>
                      <span>
                        {n.kind === 'voice'
                          ? 'Voice nebula'
                          : n.readOnly
                            ? 'Announcements'
                            : 'Text nebula'}
                        {n.topic ? ` · ${n.topic}` : ''}
                      </span>
                    </span>
                    {editable && (
                      <span className="cx-settings-item-actions">
                        <button
                          type="button"
                          className="cx-link-button"
                          onClick={() => {
                            setEditing(n.id)
                            setDraft({ name: n.name, topic: n.topic ?? '', readOnly: n.readOnly })
                          }}
                        >
                          Edit
                        </button>
                        <DeleteNebula
                          name={n.name}
                          onDelete={() => void run(() => api.removeNebula(c.id, n.id))}
                        />
                      </span>
                    )}
                  </>
                )}
              </div>
            ))}
          </section>
        )
      })}
      {editable && (
        <form
          className="cx-settings-card"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!catName.trim()) return
            const ok = await run(() => api.addCategory(c.id, catName))
            if (ok) setCatName('')
          }}
        >
          <strong>New category</strong>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <label className="cx-field">
              Name
              <input
                type="text"
                value={catName}
                maxLength={CATEGORY_NAME_MAX}
                placeholder="Gaming"
                onChange={(e) => setCatName(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="cx-button cx-button--primary"
              disabled={busy || !catName.trim()}
            >
              Add category
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function CategoryName({
  name,
  onSave
}: {
  name: string
  onSave: (name: string) => void
}): React.JSX.Element {
  const [value, setValue] = useState(name)
  const [was, setWas] = useState(name)
  if (was !== name) {
    setWas(name)
    setValue(name)
  }
  return (
    <input
      className="cx-settings-cat-input"
      aria-label="Category name"
      value={value}
      maxLength={CATEGORY_NAME_MAX}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value.trim() && value.trim() !== name && onSave(value.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

function DeleteNebula({
  name,
  onDelete
}: {
  name: string
  onDelete: () => void
}): React.JSX.Element {
  const [sure, setSure] = useState(false)
  return sure ? (
    <span className="cx-settings-confirm">
      Delete {name} and all its messages?
      <button type="button" className="cx-link-button cx-link-button--danger" onClick={onDelete}>
        Delete
      </button>
      <button type="button" className="cx-link-button" onClick={() => setSure(false)}>
        Keep
      </button>
    </span>
  ) : (
    <button
      type="button"
      className="cx-link-button cx-link-button--danger"
      onClick={() => setSure(true)}
    >
      Delete
    </button>
  )
}

/** Roles (Roles.dc.html): highest first; the selected one's name, color and permissions. */
function RolesPage({ c, busy, run }: PageProps): React.JSX.Element {
  const editable = can(c, 'manageRoles')
  const roles = c.roles
  const [selected, setSelected] = useState<string>(
    () => roles.find((r) => r.kind === 'moderator')?.id ?? roles[1]?.id ?? roles[0].id
  )
  const role = roles.find((r) => r.id === selected) ?? roles[0]
  const mine = role.kind !== 'owner' && (c.me.owner || role.position < c.me.rank) && editable
  const [name, setName] = useState(role.name)
  const [nameFor, setNameFor] = useState(`${role.id}:${role.name}`)
  if (nameFor !== `${role.id}:${role.name}`) {
    setNameFor(`${role.id}:${role.name}`)
    setName(role.name)
  }
  const [drag, setDrag] = useState<string | null>(null)
  const plural =
    role.kind === 'owner' ? 'the Owner' : role.name.endsWith('s') ? role.name : `${role.name}s`

  function reorder(dragId: string, beforeId: string): void {
    const movable = roles.filter(
      (r) => r.kind !== 'owner' && r.kind !== 'member' && (c.me.owner || r.position < c.me.rank)
    )
    const ids = movable.map((r) => r.id).filter((id) => id !== dragId)
    const at = ids.indexOf(beforeId)
    ids.splice(at < 0 ? ids.length : at, 0, dragId)
    void run(() => api.orderRoles(c.id, ids))
  }

  return (
    <div className="cx-settings-body cx-settings-body--roles">
      <p className="cx-roles-note">
        People get everything their highest role allows. Only roles below yours can be changed.
      </p>
      <div className="cx-roles">
        <ul aria-label="Roles, highest first" className="cx-roles-list">
          {roles.map((r) => {
            const movable =
              editable &&
              r.kind !== 'owner' &&
              r.kind !== 'member' &&
              (c.me.owner || r.position < c.me.rank)
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className="cx-role-row"
                  aria-pressed={r.id === role.id}
                  draggable={movable}
                  onDragStart={() => setDrag(r.id)}
                  onDragEnd={() => setDrag(null)}
                  onDragOver={(e) => movable && drag && drag !== r.id && e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (drag && drag !== r.id) reorder(drag, r.id)
                    setDrag(null)
                  }}
                  onClick={() => setSelected(r.id)}
                >
                  <span
                    className="cx-role-swatch"
                    style={{ background: (ROLE_COLORS[r.color] ?? ROLE_COLORS.gray).dot }}
                  />
                  <span className="cx-role-row-name">{r.name}</span>
                  <span className="cx-role-row-count">{r.memberCount}</span>
                </button>
              </li>
            )
          })}
        </ul>

        <section aria-labelledby="cx-role-name" className="cx-role-edit">
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}>
            <label className="cx-field">
              Role name
              <input
                id="cx-role-name"
                type="text"
                value={name}
                maxLength={ROLE_NAME_MAX}
                disabled={!mine}
                onChange={(e) => setName(e.target.value)}
                onBlur={() =>
                  mine &&
                  name.trim() &&
                  name.trim() !== role.name &&
                  void run(() => api.updateRole(c.id, role.id, { name: name.trim() }))
                }
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </label>
            {role.kind !== 'owner' && role.kind !== 'member' && (
              <div role="radiogroup" aria-label="Role color" className="cx-role-colors">
                {ROLE_COLOR_CHOICES.map((color: RoleColor) => (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={role.color === color}
                    aria-label={ROLE_COLORS[color].name}
                    disabled={!mine || busy}
                    className="cx-role-color"
                    style={{
                      background: ROLE_COLORS[color].dot,
                      boxShadow:
                        role.color === color
                          ? `0 0 0 2px var(--glo-surface), 0 0 0 4px ${ROLE_COLORS[color].dot}`
                          : undefined
                    }}
                    onClick={() => void run(() => api.updateRole(c.id, role.id, { color }))}
                  />
                ))}
              </div>
            )}
          </div>

          <h2 className="cx-role-heading">What {plural} can do</h2>
          {role.kind === 'owner' ? (
            <p className="cx-settings-text">
              Everything, including transferring ownership and deleting the constellation.
            </p>
          ) : (
            <div className="cx-perms">
              {PERMISSIONS.map((p, i) => {
                const on = role.permissions.includes(p.id)
                const grantable = c.me.owner || c.me.permissions.includes(p.id)
                return (
                  <label
                    key={p.id}
                    className={i === PERMISSIONS.length - 1 ? 'cx-perm cx-perm--last' : 'cx-perm'}
                  >
                    <span style={{ flex: 1 }}>
                      <span className="cx-perm-name">{p.name}</span>
                      {p.what && <span className="cx-perm-what">{p.what}</span>}
                    </span>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!mine || !grantable || busy}
                      onChange={() =>
                        void run(() =>
                          api.updateRole(c.id, role.id, {
                            permissions: on
                              ? role.permissions.filter((x) => x !== p.id)
                              : [...role.permissions, p.id]
                          })
                        )
                      }
                    />
                  </label>
                )
              })}
            </div>
          )}
          {mine && role.kind !== 'member' && (
            <button
              type="button"
              className="cx-link-button cx-link-button--danger"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => void run(() => api.removeRole(c.id, role.id))}
            >
              Delete this role
            </button>
          )}
        </section>
      </div>
    </div>
  )
}

function MembersPage({
  c,
  me,
  busy,
  run,
  onProblem
}: PageProps & { me: SignedInUser; onProblem: (m: string) => void }): React.JSX.Element {
  const [requests, setRequests] = useState<JoinRequest[] | null>(null)
  const [bans, setBans] = useState<ConstellationBan[] | null>(null)
  const [query, setQuery] = useState('')
  const [transferTo, setTransferTo] = useState<PublicUser | null>(null)
  useEffect(() => {
    if (can(c, 'approveRequests'))
      void api.requests(c.id).then((r) => r.ok && setRequests(r.data.requests))
    if (can(c, 'ban')) void api.bans(c.id).then((r) => r.ok && setBans(r.data.bans))
  }, [c])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...c.members]
      .sort(
        (a, b) =>
          topRole(c, b.user.id).position - topRole(c, a.user.id).position ||
          a.user.displayName.localeCompare(b.user.displayName)
      )
      .filter(
        (m) =>
          !q ||
          m.user.displayName.toLowerCase().includes(q) ||
          m.user.username.toLowerCase().includes(q)
      )
  }, [c, query])

  return (
    <div className="cx-settings-body">
      {requests && requests.length > 0 && (
        <section className="cx-settings-group">
          <h2>Asking to join · {requests.length}</h2>
          {requests.map((r) => (
            <div key={r.user.id} className="cx-settings-item">
              <Face person={r.user} />
              <span className="cx-settings-item-text">
                <strong>{r.user.displayName}</strong>
                <span>{r.note ? `“${r.note}”` : `@${r.user.username}`}</span>
              </span>
              <span className="cx-settings-item-actions">
                <button
                  type="button"
                  className="cx-button"
                  disabled={busy}
                  onClick={async () => {
                    if (await run(() => api.decide(c.id, r.user.id, false)))
                      setRequests((l) => l?.filter((x) => x.user.id !== r.user.id) ?? null)
                  }}
                >
                  Not now
                </button>
                <button
                  type="button"
                  className="cx-button cx-button--join"
                  disabled={busy}
                  onClick={async () => {
                    if (await run(() => api.decide(c.id, r.user.id, true)))
                      setRequests((l) => l?.filter((x) => x.user.id !== r.user.id) ?? null)
                  }}
                >
                  Let in
                </button>
              </span>
            </div>
          ))}
        </section>
      )}
      <label className="cx-field">
        Find someone
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or @username"
        />
      </label>
      <section className="cx-settings-group">
        <h2>Members · {c.members.length}</h2>
        {shown.map((m) => {
          const role = topRole(c, m.user.id)
          return (
            <div key={m.user.id} className="cx-settings-item">
              <Face person={m.user} />
              <span className="cx-settings-item-text">
                <strong
                  style={{
                    color:
                      role.kind === 'member'
                        ? undefined
                        : (ROLE_COLORS[role.color] ?? ROLE_COLORS.gray).light
                  }}
                >
                  {m.user.displayName}
                  {m.user.id === me.id ? ' (you)' : ''}
                </strong>
                <span>
                  {role.name} · joined{' '}
                  {new Date(m.joinedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                  {m.timedOutUntil ? ' · timed out' : ''}
                </span>
              </span>
              {c.me.owner && m.user.id !== me.id && (
                <span className="cx-settings-item-actions">
                  <button
                    type="button"
                    className="cx-link-button"
                    onClick={() => setTransferTo(m.user)}
                  >
                    Make Owner
                  </button>
                </span>
              )}
              {!c.me.owner && outranks(c, me.id, m.user.id) && can(c, 'timeoutKick') && (
                <span className="cx-settings-item-actions">
                  <button
                    type="button"
                    className="cx-link-button cx-link-button--danger"
                    onClick={() => void run(() => api.kick(c.id, m.user.id))}
                  >
                    Kick
                  </button>
                </span>
              )}
            </div>
          )
        })}
      </section>
      {bans && bans.length > 0 && (
        <section className="cx-settings-group">
          <h2>Banned · {bans.length}</h2>
          {bans.map((b) => (
            <div key={b.user.id} className="cx-settings-item">
              <Face person={b.user} />
              <span className="cx-settings-item-text">
                <strong>{b.user.displayName}</strong>
                <span>
                  {b.by ? `By ${firstName(b.by)}` : 'Banned'}
                  {b.reason ? ` · ${b.reason}` : ''}
                </span>
              </span>
              <span className="cx-settings-item-actions">
                <button
                  type="button"
                  className="cx-link-button"
                  onClick={async () => {
                    const r = await api.unban(c.id, b.user.id)
                    if (!r.ok) onProblem(r.message)
                    else setBans((l) => l?.filter((x) => x.user.id !== b.user.id) ?? null)
                  }}
                >
                  Unban
                </button>
              </span>
            </div>
          ))}
        </section>
      )}
      {transferTo && (
        <div className="cx-settings-confirm-box" role="alertdialog" aria-label="Transfer ownership">
          <p>
            Make <strong>{transferTo.displayName}</strong> the Owner of {c.name}? You&apos;ll become
            an Admin, and only they can give it back.
          </p>
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="cx-button" onClick={() => setTransferTo(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="cx-button cx-button--danger"
              disabled={busy}
              onClick={async () => {
                if (await run(() => api.transfer(c.id, transferTo.id))) setTransferTo(null)
              }}
            >
              Transfer ownership
            </button>
          </span>
        </div>
      )}
    </div>
  )
}

function InvitesPage({
  c,
  friends,
  onProblem
}: {
  c: ConstellationDetail
  friends: PublicUser[]
  onProblem: (m: string) => void
}): React.JSX.Element {
  const allowed = can(c, 'invite')
  const [links, setLinks] = useState<ConstellationLink[] | null>(null)
  const [lifetime, setLifetime] = useState<LinkLifetime>(DEFAULT_LINK_LIFETIME)
  const [maxUses, setMaxUses] = useState<string>('')
  const [copied, setCopied] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [sent, setSent] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (allowed) void api.links(c.id).then((r) => r.ok && setLinks(r.data.links))
  }, [allowed, c.id])
  const memberIds = new Set(c.members.map((m) => m.user.id))
  const invitable = friends.filter(
    (f) =>
      !memberIds.has(f.id) &&
      (!query.trim() || f.displayName.toLowerCase().includes(query.trim().toLowerCase()))
  )

  if (!allowed)
    return (
      <div className="cx-settings-body">
        <p className="cx-settings-text">Your role can’t invite people here.</p>
      </div>
    )

  async function copy(link: ConstellationLink): Promise<void> {
    try {
      await navigator.clipboard.writeText(`https://${constellationLink(link.code)}`)
      setCopied(link.id)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      onProblem("Couldn't copy the link.")
    }
  }

  return (
    <div className="cx-settings-body">
      <section className="cx-settings-group">
        <h2>Invite friends</h2>
        <p className="cx-settings-text">They’ll see it on their Constellations dashboard.</p>
        <input
          className="cx-settings-search"
          type="search"
          placeholder="Find a friend"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="cx-invite-friends">
          {invitable.slice(0, 40).map((f) => (
            <label key={f.id} className="cx-invite-friend">
              <input
                type="checkbox"
                checked={picked.includes(f.id)}
                onChange={(e) =>
                  setPicked((l) => (e.target.checked ? [...l, f.id] : l.filter((x) => x !== f.id)))
                }
              />
              <Face person={f} size={28} />
              {f.displayName}
            </label>
          ))}
          {invitable.length === 0 && (
            <p className="cx-settings-text">All your friends are in it already.</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            type="button"
            className="cx-button cx-button--primary"
            disabled={!picked.length}
            onClick={async () => {
              const r = await api.invite(c.id, picked)
              if (!r.ok) onProblem(r.message)
              else {
                setSent(
                  r.data.invited === 1 ? '1 friend invited.' : `${r.data.invited} friends invited.`
                )
                setPicked([])
              }
            }}
          >
            Send invites
          </button>
          {sent && <span className="cx-settings-text">{sent}</span>}
        </div>
      </section>

      <section className="cx-settings-group">
        <h2>Invite links</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="cx-field" style={{ flex: '0 0 150px' }}>
            Works for
            <select value={lifetime} onChange={(e) => setLifetime(e.target.value as LinkLifetime)}>
              {LINK_LIFETIMES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="cx-field" style={{ flex: '0 0 150px' }}>
            Max uses
            <input
              type="number"
              min={1}
              max={1000}
              placeholder="No limit"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="cx-button cx-button--primary"
            onClick={async () => {
              const n = maxUses ? Math.max(1, Math.min(1000, Number(maxUses) || 1)) : null
              const r = await api.addLink(c.id, lifetime, n)
              if (!r.ok) onProblem(r.message)
              else {
                setLinks((l) => [r.data.link, ...(l ?? [])])
                void copy(r.data.link)
              }
            }}
          >
            Make a link
          </button>
        </div>
        {(links ?? []).map((l) => (
          <div key={l.id} className="cx-settings-item">
            <span className="cx-settings-item-text">
              <strong className="cx-link-code">{constellationLink(l.code)}</strong>
              <span>
                {l.uses} used{l.maxUses ? ` of ${l.maxUses}` : ''} ·{' '}
                {l.expiresAt
                  ? `works until ${new Date(l.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                  : 'never expires'}
                {l.createdBy ? ` · by ${firstName(l.createdBy)}` : ''}
              </span>
            </span>
            <span className="cx-settings-item-actions">
              <button type="button" className="cx-link-button" onClick={() => void copy(l)}>
                {copied === l.id ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                className="cx-link-button cx-link-button--danger"
                onClick={async () => {
                  await api.revokeLink(c.id, l.id)
                  setLinks((list) => list?.filter((x) => x.id !== l.id) ?? null)
                }}
              >
                Turn off
              </button>
            </span>
          </div>
        ))}
        {links && links.length === 0 && (
          <p className="cx-settings-text">No working links. Make one to share anywhere.</p>
        )}
      </section>
    </div>
  )
}

function ModerationPage({
  c,
  me
}: {
  c: ConstellationDetail
  me: SignedInUser
}): React.JSX.Element {
  const [entries, setEntries] = useState<ModerationEntry[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  useEffect(() => {
    void api.moderation(c.id).then((r) => {
      if (r.ok) {
        setEntries(r.data.entries)
        setHasMore(r.data.hasMore)
      }
    })
  }, [c.id])
  const timedOut = c.members.filter((m) => m.timedOutUntil)
  return (
    <div className="cx-settings-body">
      {timedOut.length > 0 && (
        <section className="cx-settings-group">
          <h2>Timed out now · {timedOut.length}</h2>
          {timedOut.map((m) => (
            <div key={m.user.id} className="cx-settings-item">
              <Face person={m.user} />
              <span className="cx-settings-item-text">
                <strong>{m.user.displayName}</strong>
                <span>
                  Until{' '}
                  {new Date(m.timedOutUntil!).toLocaleString(undefined, {
                    weekday: 'short',
                    hour: 'numeric',
                    minute: '2-digit'
                  })}
                </span>
              </span>
            </div>
          ))}
        </section>
      )}
      <section className="cx-settings-group">
        <h2>What happened</h2>
        {entries === null && <p className="cx-settings-text">Loading…</p>}
        {entries?.length === 0 && <p className="cx-settings-text">Nothing yet.</p>}
        {entries?.map((e) => (
          <div key={e.id} className="cx-mod-line">
            <span className="cx-mod-when">
              {new Date(e.createdAt).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
              })}
            </span>
            <span>{moderationLine(e, me.id)}</span>
          </div>
        ))}
        {hasMore && entries && (
          <button
            type="button"
            className="cx-button"
            style={{ alignSelf: 'flex-start' }}
            onClick={async () => {
              const r = await api.moderation(c.id, entries[entries.length - 1].createdAt)
              if (r.ok) {
                setEntries([...entries, ...r.data.entries])
                setHasMore(r.data.hasMore)
              }
            }}
          >
            Show older
          </button>
        )}
      </section>
    </div>
  )
}

function DeletePage({
  c,
  onDeleted
}: {
  c: ConstellationDetail
  onDeleted: () => void
}): React.JSX.Element {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="cx-settings-body">
      <p className="cx-settings-text">
        Deleting <strong>{c.name}</strong> removes every nebula and all their messages and files,
        for everyone. It can&apos;t be undone. If you just want to step back, you can transfer
        ownership from Members instead.
      </p>
      <label className="cx-field">
        Type {c.name} to confirm
        <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </label>
      {error && <p className="cx-error">{error}</p>}
      <button
        type="button"
        className="cx-button cx-button--danger"
        style={{ alignSelf: 'flex-start' }}
        disabled={typed.trim() !== c.name || busy}
        onClick={async () => {
          setBusy(true)
          const r = await api.remove(c.id, typed.trim())
          setBusy(false)
          if (!r.ok) setError(r.message)
          else onDeleted()
        }}
      >
        Delete constellation
      </button>
    </div>
  )
}
