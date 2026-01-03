/**
 * Seanime Extension for Comix
 * Implements MangaProvider interface for 'https://comix.to'.
 */
class Provider {

    constructor() {
        this.api = 'https://comix.to';
        this.apiUrl = 'https://comix.to/api/v2';
    }

    getSettings() {
        return {
            supportsMultiScanlator: true,
        };
    }

    /**
     * Searches for manga.
     */
    async search(opts) {
        const queryParam = opts.query;
        const url = `${this.apiUrl}/manga?keyword=${encodeURIComponent(queryParam)}&order[relevance]=desc`;

        try {
            const response = await fetch(url);
            if (!response.ok) return [];
            
            const data = await response.json();
            if (!data.result || !data.result.items) return [];

            const items = data.result.items;
            let mangas = [];

            items.forEach((item) => {
                const compositeId = `${item.hash_id}:::${item.slug}`;

                let imageUrl = '';
                if (item.poster) {
                    imageUrl = item.poster.medium || item.poster.large || item.poster.small || '';
                }

                mangas.push({
                    id: compositeId,
                    title: item.title,
                    synonyms: item.alt_titles,
                    year: undefined,
                    image: imageUrl, 
                });
            });

            return mangas;
        }
        catch (e) {
            console.error(e);
            return [];
        }
    }

    /**
     * Finds all chapters 
     */
    async findChapters(mangaId) {
        const separator = mangaId.includes(':::') ? ':::' : '|';
        const [hashId, slug] = mangaId.split(separator);
        if (!hashId || !slug) return [];

        const baseUrl = `${this.apiUrl}/manga/${hashId}/chapters?order[number]=desc&limit=100`;

        try {
            const firstRes = await fetch(baseUrl);
            if (!firstRes.ok) return [];
            const firstData = await firstRes.json();

            if (!firstData.result || !firstData.result.items) return [];

            const totalPages = firstData.result.pagination?.last_page || 1;

            let allChapters = [...firstData.result.items];

            const pagePromises = [];
            for (let page = 2; page <= totalPages; page++) {
                const pageUrl = `${baseUrl}&page=${page}`;
                pagePromises.push(
                    fetch(pageUrl)
                        .then(res => res.ok ? res.json() : null)
                        .then(data => data?.result?.items || [])
                        .catch(() => [])
                );
            }
            const pageResults = await Promise.all(pagePromises);
            pageResults.forEach(items => allChapters.push(...items));

            // Map chapters with proper title & scanlator
            let chapters = allChapters.map((item) => {
                const compositeChapterId = `${hashId}:::${slug}:::${item.chapter_id}:::${item.number}`;

                // Chapter title rules
                const chapterTitle = item.name && item.name.trim().length > 0
                    ? `Chapter ${item.number} — ${item.name}`
                    : `Chapter ${item.number}`;

                return {
                    id: compositeChapterId,
                    url: `${this.api}/title/${hashId}-${slug}/${item.chapter_id}-chapter-${item.number}`,
                    title: chapterTitle,
                    chapter: item.number.toString(),
                    index: 0,
                    scanlator:
                        item.is_official === 1
                            ? "Official"
                            : (item.scanlation_group?.name?.trim() || undefined),
                    language: item.language
                };
            });

            chapters.sort((a, b) => (parseFloat(a.chapter) || 0) - (parseFloat(b.chapter) || 0));
            chapters.forEach((chapter, i) => (chapter.index = i));

            return chapters;
        }
        catch (e) {
            console.error(e);
            return [];
        }
    }

    /**
     * Finds all image pages.
     */
    async findChapterPages(chapterId) {
        const separator = chapterId.includes(':::') ? ':::' : '|';
        const parts = chapterId.split(separator);
        if (parts.length < 4) return [];

        const [hashId, slug, specificChapterId, number] = parts;
        const url = `${this.api}/title/${hashId}-${slug}/${specificChapterId}-chapter-${number}`;

        try {
            const response = await fetch(url);
            if (!response.ok) return [];
            const body = await response.text();

            const startMatch = body.match(/"images"\s*:\s*\[/);
            if (!startMatch) {
                console.error("Images array not found");
                return [];
            }

            const startIdx = body.indexOf(startMatch[0]) + startMatch[0].length - 1;
            let depth = 1, endIdx = startIdx + 1;
            while (depth > 0 && endIdx < body.length) {
                if (body[endIdx] === '[') depth++;
                if (body[endIdx] === ']') depth--;
                endIdx++;
            }
            const imagesJson = body.slice(startIdx, endIdx);

            let images = [];
            try {
                images = JSON.parse(imagesJson);
            } catch {
                const clean = imagesJson.replace(/\\"/g, '"');
                images = JSON.parse(clean);
            }

            if (!Array.isArray(images)) return [];

            return images
                .filter((img) => img && img.url)
                .map((img, index) => ({
                    url: img.url,
                    index,
                    headers: {
                        Referer: url,
                    },
                }));
        }
        catch (e) {
            console.error(e);
            return [];
        }
    }
}