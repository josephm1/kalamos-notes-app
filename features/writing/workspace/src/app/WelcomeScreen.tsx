import { useEffect, useState } from "react";
import { listRecentFiles, type RecentFileMeta } from "../storage/db";
import { openMarkdown, type OpenedDocument } from "../documents/files";
import { SAMPLE_DOC } from "../test-fixtures/sample";
import { fingerprintOf } from "../documents/fingerprint";

type Props = {
  onOpen: () => void;
  onOpenRecent: (doc: OpenedDocument) => void;
};

/** Minimal landing state — open a file or try the built-in sample. */
export function WelcomeScreen({ onOpen, onOpenRecent }: Props) {
  const [recent, setRecent] = useState<RecentFileMeta[]>([]);

  useEffect(() => {
    listRecentFiles().then(setRecent);
  }, []);

  const openSample = () => {
    const name = "sample.md";
    onOpenRecent({
      docId: `doc:${name}`,
      name,
      source: SAMPLE_DOC,
      fingerprint: fingerprintOf(SAMPLE_DOC),
      handle: null,
    });
  };

  return (
    <div className="welcome">
      <h1>Kalamos Write</h1>
      <p className="welcome-sub">
        A calm, local-first Markdown reader you can write on with a pen.
      </p>
      <div className="welcome-actions">
        <button className="primary" onClick={onOpen}>
          Open a Markdown file
        </button>
        <button onClick={openSample}>Try the sample document</button>
      </div>
      {recent.length > 0 && (
        <div className="recent">
          <h2>Recent</h2>
          <ul>
            {recent.map((r) => (
              <li key={r.docId}>
                <button
                  onClick={async () => {
                    // Recent is metadata only; re-picking reconnects the sidecar.
                    const opened = await openMarkdown();
                    if (opened) onOpenRecent(opened);
                  }}
                >
                  {r.documentName}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="welcome-note">
        Files stay on your device. Handwriting is saved in a companion{" "}
        <code>.write2.json</code> sidecar.
      </p>
    </div>
  );
}
