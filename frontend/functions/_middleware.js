class MetaTagRewriter {
    constructor(tags) {
        this.tags = tags;
    }

    element(element) {
        const property = element.getAttribute("property") || element.getAttribute("name");

        if (property === "og:title" || property === "twitter:title") {
            element.setAttribute("content", this.tags.title);
        }
        if (property === "og:image" || property === "twitter:image") {
            element.setAttribute("content", this.tags.image);
        }
        if (property === "og:description" || property === "twitter:description") {
            element.setAttribute("content", this.tags.description);
        }
    }
}

export async function onRequest(context) {
    const { request, next, env } = context;
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    let articleId = null;
    if (path.startsWith("/article/")) {
        const pathParts = path.split("/");
        articleId = pathParts[2];
    }

    const response = await next();
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return response;

    const IMAGE_BASE = "https://pub-5fcbf3326b604a8284068a24252f1585.r2.dev";

    let currentTags = {
        title: "Super League - IIIT Kottayam",
        description: "Official portal for The Super League at IIIT Kottayam. Access match schedules, recent results, and league announcements.",
        image: `${IMAGE_BASE}/home.png`
    };

    if (articleId) {
        try {
            const supabaseResponse = await fetch(
                `${env.SUPABASE_URL}/rest/v1/newsletter?id=eq.${articleId}&select=title,summary,image_url`,
                {
                    headers: {
                        apikey: env.SUPABASE_ANON_KEY,
                        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`
                    }
                }
            );

            if (supabaseResponse.ok) {
                const data = await supabaseResponse.json();
                if (data?.[0]) {
                    currentTags.title = data[0].title || "Newsletter | Super League";
                    
                    const rawSummary = data[0].summary || currentTags.description;
                    currentTags.description = rawSummary.replace(/[\r\n]+/g, " ").trim();
                    
                    if (data[0].image_url) {
                        currentTags.image = data[0].image_url;
                    }
                }
            }
        } catch (err) {
            console.error(err);
        }
    } else if (["/", "/fantasy", "/wc", "/matches", "/standings", "/clubs", "/statistics", "/legends", "/rules"].includes(path)) {
        const customNames = {
            "/": "Home",
            "/wc": "FIFA World Cup 2026 Fantasy"
        };

        const filename = path === "/" ? "home" : path.slice(1);
        const pageName = customNames[path] || (path.slice(1).charAt(0).toUpperCase() + path.slice(2));

        const descriptions = {
            "/": "Official portal for The Super League at IIIT Kottayam. Access match schedules, recent results, and league announcements.",
            "/fantasy": "Predict match scores, winners, and top scorers.",
            "/wc": "[NOW LIVE] World Cup Fantasy bracket. Predict group stage standings and complete the interactive knockout bracket through to the final.",
            "/matches": "Official fixtures, live scores, and historical match data.",
            "/standings": "Current team standings, points table, and goal differences.",
            "/clubs": "Team rosters, squad details, and individual FUT profiles.",
            "/statistics": "Comprehensive player and team statistics.",
            "/rules": "Official tournament regulations and fantasy scoring guidelines.",
            "/legends": "Hall of fame and historical records of The Super League."
        };

        currentTags.title = `${pageName} | Super League`;
        currentTags.image = `${IMAGE_BASE}/${filename}.png`;
        currentTags.description = descriptions[path] || currentTags.description;
    }

    return new HTMLRewriter().on("meta", new MetaTagRewriter(currentTags)).transform(response);
}
