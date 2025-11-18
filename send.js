const fetch = require("node-fetch");

// 로테이션 알고리즘 목록
const ROTATION = ["bfs", "dp", "graph", "tree", "greedy", "two-pointers",
    "array", "string", "simulation", "binary-search", "hash-table", "heap",
    "backtracking", "design", "sorting", "math", "stack", "queue", "linked-list", "binary-tree"];

function getRotationTag(todayIndex) {
    if (todayIndex < 0) {
        todayIndex = todayIndex * -1;
    }
    return ROTATION[todayIndex % ROTATION.length];
}

async function loadLeetCodeProblems() {
    const response = await fetch("https://leetcode.com/api/problems/all/");
    const data = await response.json();

    return data.stat_status_pairs.map(p => ({
        id: p.stat.frontend_question_id,
        title: p.stat.question__title,
        slug: p.stat.question__title_slug,
        level: p.difficulty.level, // 1=Easy, 2=Medium, 3=Hard
        tags: p.stat.topicTags?.map(t => t.slug) || []
    }));
}

function pickProblems(all, {difficulty, tag, count}) {
    const filtered = all.filter(p =>
        p.level === difficulty &&
        p.tags.includes(tag)
    );

    if (filtered.length < count) {
        // 태그 매칭 실패 시 태그 무시하고 난이도 기준으로만 선택
        const fallback = all.filter(p => p.level === difficulty);
        return fallback.sort(() => 0.5 - Math.random()).slice(0, count);
    }

    return filtered.sort(() => 0.5 - Math.random()).slice(0, count);
}

async function sendSlack(problems) {
    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (!webhook) throw new Error("SLACK_WEBHOOK_URL 환경변수 없음");

    const lines = problems.map(p =>
        `• *${p.title}* (${p.kDifficulty})\n${p.url}`
    );

    const message = {
        text: `📘 *오늘의 리트코드 문제 (${problems.length}문제)*\n\n${lines.join("\n\n")}`
    };

    const res = await fetch(webhook, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(message)
    });

    if (!res.ok) {
        const errData = await res.text();
        throw new Error(`Slack 전송 실패: ${res.status} ${res.statusText} - ${errData}`);
    }
}

async function saveToNotion(problems) {
    const token = process.env.NOTION_TOKEN;
    const dbId = process.env.NOTION_DATABASE_ID;

    if (!token || !dbId) throw new Error("NOTION_TOKEN 또는 NOTION_DATABASE_ID 환경변수 없음");

    for (const p of problems) {
        const res = await fetch("https://api.notion.com/v1/pages", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "Notion-Version": "2022-06-28"
            },
            body: JSON.stringify({
                parent: {database_id: dbId},
                properties: {
                    Name: {
                        title: [{text: {content: p.title}}]
                    },
                    Difficulty: {
                        select: {name: p.kDifficulty}
                    },
                    Url: {
                        url: p.url
                    },
                    Tag: {
                        select: {name: p.tag}
                    },
                    Date: {
                        date: {start: new Date().toISOString()}
                    }
                }
            })
        });

        const data = await res.json();

        if (!res.ok) {
            console.error("Notion API Error:", data);
            throw new Error(`Notion 기록 실패: ${data.message || JSON.stringify(data)}`);
        } else {
            console.log("Notion 기록 성공:", data.id);
        }
    }
}

(async () => {
    try {
        const today = new Date();
        const dayIndex = Math.floor((today - new Date("2025-11-19")) / 86400000); // 시작 기준일 자유 설정

        const isFirst10 = dayIndex < 10;
        const rotationTag = getRotationTag(dayIndex);

        const difficulty = isFirst10 ? 1 : 2; // 1=Easy, 2=Medium
        const count = isFirst10 ? 2 : 1;

        const all = await loadLeetCodeProblems();

        let selected = pickProblems(all, {
            difficulty,
            tag: rotationTag,
            count
        });

        selected = selected.map(p => ({
            ...p,
            kDifficulty: difficulty === 1 ? "Easy" : "Medium",
            url: `https://leetcode.com/problems/${p.slug}/`,
            tag: rotationTag
        }));

        await sendSlack(selected);
        await saveToNotion(selected);

        console.log("Done!", selected);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1); // GitHub Actions에서도 실패로 표시
    }
})();
