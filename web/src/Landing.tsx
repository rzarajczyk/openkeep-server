import {
  ArrowLeft,
  CheckSquare,
  Cloud,
  Container,
  Database,
  FileUp,
  KeyRound,
  Paperclip,
  Pin,
  Server,
  Shield,
  Tags,
} from 'lucide-react'
import { useState } from 'react'
import { Login } from './Login'

type LandingView = 'choose' | 'hosted' | 'self-host'
type InstallMethod = 'compose' | 'docker'

interface LandingProps {
  onLogin: (login: string, password: string, signal: AbortSignal) => Promise<void>
}

const REPO_RAW = 'https://raw.githubusercontent.com/rzarajczyk/ownkeep-server/main'
const COMPOSE_FILE_URL = `${REPO_RAW}/docker-compose.yaml`
const ENV_EXAMPLE_URL = `${REPO_RAW}/.env.example`

const INSTALL_OPTIONS: {
  id: InstallMethod
  title: string
  summary: string
  icon: typeof Container
}[] = [
  {
    id: 'compose',
    title: 'Docker Compose',
    summary: 'OwnKeep + PostgreSQL as containers',
    icon: Container,
  },
  {
    id: 'docker',
    title: 'Docker only',
    summary: 'Bring your own Postgres (e.g. Neon)',
    icon: Database,
  },
]

const FEATURES: {
  title: string
  copy: string
  icon: typeof Shield
}[] = [
  {
    title: 'Zero-knowledge encryption',
    copy: 'Notes unlock in your browser. The server only ever stores ciphertext.',
    icon: Shield,
  },
  {
    title: 'Text & checklists',
    copy: 'Capture ideas and to-dos with markdown text or indented checklists.',
    icon: CheckSquare,
  },
  {
    title: 'Labels, pins & archive',
    copy: 'Organize the Keep-style board without exposing labels in the clear.',
    icon: Tags,
  },
  {
    title: 'Encrypted attachments',
    copy: 'Images and files ride along with the note, encrypted under the same vault.',
    icon: Paperclip,
  },
  {
    title: 'Google Keep import',
    copy: 'Bring a Takeout ZIP in client-side — no plaintext dump on the server.',
    icon: FileUp,
  },
  {
    title: 'Multi-user on your server',
    copy: 'Admin-managed accounts for a household or small team, packaged for Docker.',
    icon: Server,
  },
]

export function Landing({ onLogin }: LandingProps) {
  const [view, setView] = useState<LandingView>('choose')
  const [method, setMethod] = useState<InstallMethod>('compose')

  return (
    <main className={`login-page${view === 'choose' ? ' landing-page--choose' : ''}`}>
      <section
        className={`login-panel${view === 'choose' || view === 'self-host' ? ' login-panel--wide' : ''}`}
        aria-labelledby={view === 'hosted' ? 'login-heading' : 'landing-heading'}
      >
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            <KeyRound />
          </span>
          <span>OwnKeep</span>
        </div>

        {view === 'choose' && (
          <div className="landing-choose">
            <div className="login-copy">
              <span className="eyebrow">Encrypted notes you control</span>
              <h1 id="landing-heading">OwnKeep</h1>
              <p>A calm Keep-style workspace. Run it yourself, or sign in to the hosted service.</p>
            </div>
            <div className="landing-choices" role="group" aria-label="How do you want to use OwnKeep?">
              <button type="button" className="landing-choice" onClick={() => setView('hosted')}>
                <Cloud aria-hidden="true" />
                <span className="landing-choice-title">Hosted service</span>
                <span className="landing-choice-copy">
                  Sign in to the OwnKeep service hosted by us for a low monthly fee
                </span>
              </button>
              <button type="button" className="landing-choice" onClick={() => setView('self-host')}>
                <Server aria-hidden="true" />
                <span className="landing-choice-title">Self-host</span>
                <span className="landing-choice-copy">Install on your own machine or cloud for free</span>
              </button>
            </div>
            <FeatureHighlights />
          </div>
        )}

        {view === 'hosted' && (
          <Login onLogin={onLogin} onBack={() => setView('choose')} embedded />
        )}

        {view === 'self-host' && (
          <div className="landing-self-host">
            <button type="button" className="landing-back" onClick={() => setView('choose')}>
              <ArrowLeft aria-hidden="true" />
              Back
            </button>
            <div className="login-copy login-copy--compact">
              <span className="eyebrow">Self-host</span>
              <h1 id="landing-heading">Install OwnKeep</h1>
              <p>Pick a deployment path. Both use the same zero-knowledge app image.</p>
            </div>
            <div className="install-methods" role="tablist" aria-label="Installation method">
              {INSTALL_OPTIONS.map((option) => {
                const Icon = option.icon
                const selected = method === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={`install-method${selected ? ' is-selected' : ''}`}
                    onClick={() => setMethod(option.id)}
                  >
                    <Icon aria-hidden="true" />
                    <span className="install-method-title">{option.title}</span>
                    <span className="install-method-copy">{option.summary}</span>
                  </button>
                )
              })}
            </div>
            <InstallGuide method={method} />
          </div>
        )}
      </section>
      <aside className="login-art" aria-hidden="true">
        {view === 'choose' ? <ProductStage /> : <LegacyArtNotes />}
      </aside>
    </main>
  )
}

function FeatureHighlights() {
  return (
    <section className="landing-features" aria-label="Main features">
      <h2 className="landing-features-heading">What you get</h2>
      <ul className="landing-feature-list">
        {FEATURES.map((feature) => {
          const Icon = feature.icon
          return (
            <li key={feature.title} className="landing-feature">
              <span className="landing-feature-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="landing-feature-title">{feature.title}</span>
              <span className="landing-feature-copy">{feature.copy}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ProductStage() {
  return (
    <div className="product-stage">
      <div className="stage-note stage-note-text">
        <div className="stage-note-top">
          <span className="stage-chip">
            <Shield /> Encrypted
          </span>
          <Pin className="stage-pin" />
        </div>
        <strong>Weekend market</strong>
        <p>Sourdough, tulips, and the good olive oil. Leave room for something unexpected.</p>
        <div className="stage-labels">
          <span>errands</span>
          <span>home</span>
        </div>
        <div className="stage-attach">
          <span className="stage-thumb" />
          <span>receipt.jpg</span>
        </div>
      </div>
      <div className="stage-note stage-note-list">
        <span className="stage-eyebrow">Checklist</span>
        <strong>Packing</strong>
        <ul>
          <li className="is-done">
            <CheckSquare /> Passport
          </li>
          <li>
            <CheckSquare /> Chargers
          </li>
          <li>
            <CheckSquare /> Book for the train
          </li>
        </ul>
      </div>
      <div className="stage-note stage-note-vault">
        <KeyRound />
        <div>
          <strong>Vault unlocked</strong>
          <p>Keys stay in the browser. Ciphertext syncs quietly.</p>
        </div>
      </div>
    </div>
  )
}

function LegacyArtNotes() {
  return (
    <>
      <div className="art-note art-note-one">
        <span>Today</span>
        <strong>Make space for good ideas.</strong>
        <i />
        <i />
        <i />
      </div>
      <div className="art-note art-note-two">
        <span>Weekend</span>
        <p>□ Market flowers</p>
        <p>✓ Fresh bread</p>
        <p>□ Call Mum</p>
      </div>
    </>
  )
}

function InstallGuide({ method }: { method: InstallMethod }) {
  if (method === 'compose') {
    return (
      <article className="install-guide" aria-live="polite">
        <h2>Docker Compose</h2>
        <p>
          Runs OwnKeep and PostgreSQL together from the published image. Needs Docker Desktop or Docker Engine
          with Compose — no git clone.
        </p>
        <ol>
          <li>
            Download{' '}
            <a href={COMPOSE_FILE_URL} target="_blank" rel="noreferrer">
              docker-compose.yaml
            </a>{' '}
            and{' '}
            <a href={ENV_EXAMPLE_URL} target="_blank" rel="noreferrer">
              .env.example
            </a>{' '}
            into an empty folder:
            <pre>
              <code>{`mkdir ownkeep && cd ownkeep
curl -fsSLO ${COMPOSE_FILE_URL}
curl -fsSLO ${ENV_EXAMPLE_URL}`}</code>
            </pre>
          </li>
          <li>
            Create <code>.env</code> and replace every <code>CHANGE_ME</code>. Keep the database host as{' '}
            <code>db</code>:
            <pre>
              <code>{`cp .env.example .env
# OWNKEEP_DATABASE_URL=postgresql://ownkeep:…@db:5432/ownkeep
# Set OWNKEEP_ADMIN_USERNAME / OWNKEEP_ADMIN_PASSWORD`}</code>
            </pre>
          </li>
          <li>
            Start the stack:
            <pre>
              <code>docker compose up -d</code>
            </pre>
          </li>
          <li>
            Open <code>http://localhost:8080</code> and sign in with the admin credentials from{' '}
            <code>.env</code>.
          </li>
        </ol>
      </article>
    )
  }

  return (
    <article className="install-guide" aria-live="polite">
      <h2>Docker + your database</h2>
      <p>
        Runs only the OwnKeep container. Point <code>OWNKEEP_DATABASE_URL</code> at Neon or any Postgres you
        already have.
      </p>
      <ol>
        <li>
          Create a Postgres database and copy its connection string (Neon: paste the console URL as-is,
          including <code>sslmode=require</code>).
        </li>
        <li>
          Start OwnKeep:
          <pre>
            <code>{`docker run -d --name ownkeep \\
  -p 8080:8080 \\
  -e OWNKEEP_DATABASE_URL='postgresql://USER:PASSWORD@HOST/DB?sslmode=require' \\
  -e OWNKEEP_ADMIN_USERNAME=admin \\
  -e OWNKEEP_ADMIN_PASSWORD='long-unique-password' \\
  -v ownkeep-attachments:/data/attachments \\
  rzarajczyk/ownkeep:latest`}</code>
          </pre>
        </li>
        <li>
          Open <code>http://localhost:8080</code> and sign in with the admin username and password you set.
        </li>
      </ol>
    </article>
  )
}
