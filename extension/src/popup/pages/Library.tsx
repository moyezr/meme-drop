import { useState, useEffect, useCallback, type DragEvent } from "react";
import { apiFetch } from "../../shared/api";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
const MEME_DROP_MIME_TYPE = "application/x-memedrop-meme";

interface MemeItem {
  id: string;
  filePath: string;
  userName: string;
  userTags: string[];
  systemTags: {
    emotion?: string;
    use_cases?: string[];
  };
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

interface LibraryResponse {
  memes: MemeItem[];
  total: number;
  page: number;
}

interface DraggedMemePayload {
  memeId: string;
  imageUrl: string;
}

type SortOption = "recent" | "most_used" | "alphabetical";
type EmotionFilter =
  | ""
  | "sarcastic"
  | "absurdist"
  | "wholesome"
  | "savage"
  | "confused"
  | "celebratory";

const EMOTIONS: EmotionFilter[] = [
  "sarcastic",
  "absurdist",
  "wholesome",
  "savage",
  "confused",
  "celebratory",
];

export default function Library() {
  const [memes, setMemes] = useState<MemeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("recent");
  const [emotionFilter, setEmotionFilter] = useState<EmotionFilter>("");
  const [selectedMeme, setSelectedMeme] = useState<MemeItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editTags, setEditTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadLibrary = useCallback(() => {
    setLoading(true);
    apiFetch<LibraryResponse>("/library")
      .then((data) => {
        setMemes(data.memes);
        setError(null);
      })
      .catch((err) => {
        console.error("[MemeDrop] Failed to load library:", err);
        setError("Could not load library. Is the backend running?");
      })
      .finally(() => setLoading(false));
  }, []);

  const getMemeImageUrl = (meme: MemeItem) => `${API_BASE_URL}${meme.filePath}`;

  const onMemeDragStart = (
    event: DragEvent<HTMLElement>,
    meme: MemeItem
  ) => {
    const payload: DraggedMemePayload = {
      memeId: meme.id,
      imageUrl: getMemeImageUrl(meme),
    };

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      MEME_DROP_MIME_TYPE,
      JSON.stringify(payload)
    );
    event.dataTransfer.setData("text/uri-list", payload.imageUrl);
    event.dataTransfer.setData("text/plain", payload.imageUrl);
  };

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  // Filter and sort memes client-side
  const filteredMemes = memes
    .filter((m) => {
      // Search filter
      if (search) {
        const q = search.toLowerCase();
        const nameMatch = m.userName.toLowerCase().includes(q);
        const tagMatch = m.userTags.some((t) =>
          t.toLowerCase().includes(q)
        );
        const useCaseMatch = m.systemTags?.use_cases?.some((u) =>
          u.toLowerCase().includes(q)
        );
        if (!nameMatch && !tagMatch && !useCaseMatch) return false;
      }
      // Emotion filter
      if (emotionFilter && m.systemTags?.emotion !== emotionFilter)
        return false;
      return true;
    })
    .sort((a, b) => {
      switch (sort) {
        case "most_used":
          return b.useCount - a.useCount;
        case "alphabetical":
          return a.userName.localeCompare(b.userName);
        case "recent":
        default:
          return (
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
      }
    });

  const openDetail = (meme: MemeItem) => {
    setSelectedMeme(meme);
    setEditName(meme.userName);
    setEditTags(meme.userTags.join(", "));
  };

  const closeDetail = () => {
    setSelectedMeme(null);
    setEditName("");
    setEditTags("");
    setActionError(null);
  };

  const handleSave = async () => {
    if (!selectedMeme) return;
    setSaving(true);
    try {
      const tags = editTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await apiFetch(`/library/${selectedMeme.id}`, {
        method: "PUT",
        body: JSON.stringify({
          user_name: editName,
          user_tags: tags,
        }),
      });
      // Update local state
      setMemes((prev) =>
        prev.map((m) =>
          m.id === selectedMeme.id
            ? { ...m, userName: editName, userTags: tags }
            : m
        )
      );
      setSelectedMeme((prev) =>
        prev ? { ...prev, userName: editName, userTags: tags } : null
      );
    } catch (err) {
      console.error("[MemeDrop] Update failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedMeme) return;
    if (!window.confirm(`Delete "${selectedMeme.userName}"? This can't be undone.`)) {
      return;
    }
    setDeleting(true);
    setActionError(null);
    try {
      await apiFetch(`/library/${selectedMeme.id}`, { method: "DELETE", body: '{}' });
      setMemes((prev) => prev.filter((m) => m.id !== selectedMeme.id));
      closeDetail();
    } catch (err) {
      console.error("[MemeDrop] Delete failed:", err);
      setActionError(
        err instanceof Error ? err.message : "Delete failed. Please try again."
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleCopyImage = async () => {
    if (!selectedMeme) return;
    try {
      const res = await fetch(`${API_BASE_URL}${selectedMeme.filePath}`);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
    } catch {
      // Fallback: just show a message
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={loadLibrary}
          className="mt-2 text-xs text-blue-500 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  // Detail view
  if (selectedMeme) {
    return (
      <div>
        <button
          onClick={closeDetail}
          className="text-xs text-blue-500 hover:underline mb-3 flex items-center gap-1"
        >
          &larr; Back
        </button>
        <img
          src={getMemeImageUrl(selectedMeme)}
          alt={selectedMeme.userName}
          className="w-full rounded-lg border border-gray-200 mb-3"
          draggable
          onDragStart={(e) => onMemeDragStart(e, selectedMeme)}
        />
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-gray-400 block mb-1">
              Name
            </label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-gray-400 block mb-1">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              placeholder="e.g. funny, tech, reaction"
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
            />
          </div>
          {selectedMeme.systemTags?.use_cases &&
            selectedMeme.systemTags.use_cases.length > 0 && (
              <div>
                <label className="text-[10px] uppercase tracking-wide text-gray-400 block mb-1">
                  AI Tags
                </label>
                <div className="flex flex-wrap gap-1">
                  {selectedMeme.systemTags.use_cases.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          <div className="flex gap-4 text-[11px] text-gray-400">
            <span>Used {selectedMeme.useCount}x</span>
            {selectedMeme.lastUsedAt && (
              <span>
                Last used{" "}
                {new Date(selectedMeme.lastUsedAt).toLocaleDateString()}
              </span>
            )}
            <span>
              Saved {new Date(selectedMeme.createdAt).toLocaleDateString()}
            </span>
          </div>
          {actionError && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              {actionError}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || deleting}
              className="flex-1 text-xs bg-blue-500 text-white rounded py-1.5 hover:bg-blue-600 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={handleCopyImage}
              disabled={deleting}
              className="text-xs border border-gray-200 rounded px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
            >
              Copy
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting || saving}
              className="text-xs text-red-500 border border-red-200 rounded px-3 py-1.5 hover:bg-red-50 disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Grid view
  return (
    <div>
      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search memes..."
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-blue-400"
      />

      {/* Filters row */}
      <div className="flex items-center gap-2 mb-2 overflow-x-auto">
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="text-[11px] border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none"
        >
          <option value="recent">Recent</option>
          <option value="most_used">Most Used</option>
          <option value="alphabetical">A-Z</option>
        </select>
        <select
          value={emotionFilter}
          onChange={(e) =>
            setEmotionFilter(e.target.value as EmotionFilter)
          }
          className="text-[11px] border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none"
        >
          <option value="">All Emotions</option>
          {EMOTIONS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-gray-400 mb-2">
        {filteredMemes.length} meme{filteredMemes.length !== 1 ? "s" : ""}
        {search || emotionFilter ? " found" : " saved"}
      </p>
      <p className="text-[11px] text-gray-500 mb-2">
        Drag a meme onto the X composer to attach it.
      </p>

      {filteredMemes.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-gray-500 text-sm">
            {memes.length === 0
              ? "Your meme library is empty. Save memes from X to get started."
              : "No memes match your filters."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {filteredMemes.map((meme) => (
            <div
              key={meme.id}
              onClick={() => openDetail(meme)}
              draggable
              onDragStart={(e) => onMemeDragStart(e, meme)}
              className="group relative rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 transition-colors cursor-pointer"
            >
              <img
                src={getMemeImageUrl(meme)}
                alt={meme.userName}
                className="w-full aspect-square object-cover"
                loading="lazy"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                <p className="text-white text-xs font-medium truncate">
                  {meme.userName}
                </p>
                {meme.systemTags?.use_cases &&
                  meme.systemTags.use_cases.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {meme.systemTags.use_cases.slice(0, 2).map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] bg-white/20 text-white px-1.5 py-0.5 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
              </div>
              {meme.useCount > 0 && (
                <div className="absolute top-1 right-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                  {meme.useCount}x
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
