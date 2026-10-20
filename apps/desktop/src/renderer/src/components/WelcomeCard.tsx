import { useEffect, useState } from 'react'
import fireflyImg from '../assets/firefly.png'
import { AddFriendIcon, CameraIcon, CloseIcon, MegaphoneIcon } from './icons'
import { hideWelcome, invitedSomeone } from '../lib/welcome'

// 0.7.4: the first five minutes. A new account's Friends page used to say "No friends yet";
// now it's three steps that make Glofly useful on day one: a photo, a friend, and inviting
// friends who aren't on Glofly yet. Each step gets a check once done. With no friends it takes
// the whole page; once there are friends but no photo it sits above the list, and can be hidden.

const CheckMark = (): React.JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M5 12.5l4.2 4.2L19 7"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

export default function WelcomeCard({
  userId,
  firstName,
  hasPhoto,
  hasFriend,
  hasPendingRequest,
  compact,
  onPhoto,
  onAddFriend,
  onInvite,
  onHide
}: {
  userId: string
  firstName: string
  hasPhoto: boolean
  hasFriend: boolean
  /** A friend request sent counts as reaching out too */
  hasPendingRequest: boolean
  /** Above the friends list (there are friends already) rather than the whole page */
  compact: boolean
  onPhoto: () => void
  onAddFriend: () => void
  onInvite: () => void
  onHide: () => void
}): React.JSX.Element {
  const [invited, setInvited] = useState(() => invitedSomeone(userId))
  useEffect(() => {
    const again = (): void => setInvited(invitedSomeone(userId))
    window.addEventListener('glofly:invited', again)
    return () => window.removeEventListener('glofly:invited', again)
  }, [userId])

  const steps = [
    {
      key: 'photo',
      done: hasPhoto,
      icon: <CameraIcon size={20} />,
      title: 'Add a profile photo',
      text: 'So friends know it’s really you.',
      action: hasPhoto ? 'Change photo' : 'Add photo',
      onClick: onPhoto
    },
    {
      key: 'friend',
      done: hasFriend,
      icon: <AddFriendIcon size={20} />,
      title: 'Add a friend',
      text: hasFriend
        ? 'You’re all set to chat.'
        : hasPendingRequest
          ? 'Request sent. They’ll show up here once they accept.'
          : 'Find them by their username.',
      action: 'Add friend',
      onClick: onAddFriend
    },
    {
      key: 'invite',
      done: invited,
      icon: <MegaphoneIcon size={20} />,
      title: 'Invite friends',
      text: 'Not on Glofly yet? We’ll email them an invite from you.',
      action: invited ? 'Invite more' : 'Invite',
      onClick: onInvite
    }
  ]
  const doneCount = steps.filter((s) => s.done).length

  return (
    <section
      className={compact ? 'welcome-card welcome-card--compact' : 'welcome-card'}
      aria-labelledby="welcome-title"
    >
      {compact && (
        <button
          type="button"
          className="welcome-hide"
          aria-label="Hide these tips"
          title="Hide"
          onClick={() => {
            hideWelcome(userId)
            onHide()
          }}
        >
          <CloseIcon size={16} />
        </button>
      )}
      <div className="welcome-head">
        <img src={fireflyImg} alt="" className="empty-firefly" draggable={false} />
        <div>
          <h2 id="welcome-title">Welcome to Glofly, {firstName}!</h2>
          <p>
            {doneCount === 0
              ? 'Three quick things and you’re ready to glow.'
              : `${doneCount} of 3 done. Nice!`}
          </p>
        </div>
      </div>
      <ol className="welcome-steps">
        {steps.map((s) => (
          <li key={s.key} className={s.done ? 'welcome-step welcome-step--done' : 'welcome-step'}>
            <span className="welcome-step-icon" aria-hidden="true">
              {s.done ? <CheckMark /> : s.icon}
            </span>
            <span className="welcome-step-text">
              <strong>
                {s.title}
                {s.done && <span className="visually-hidden"> (done)</span>}
              </strong>
              <span>{s.text}</span>
            </span>
            <button
              type="button"
              className={
                s.done ? 'small-button small-button--quiet' : 'small-button small-button--primary'
              }
              onClick={s.onClick}
            >
              {s.action}
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
