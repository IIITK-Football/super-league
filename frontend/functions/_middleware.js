class MetaTagRewriter {
    constructor(tags) {
        this.tags = tags;
    }

    element(element) {
        const property =
            element.getAttribute("property") ||
            element.getAttribute("name");

        if (property === "og:title" || property === "twitter:title") {
            element.setAttribute("content", this.tags.title);
        }

        if (property === "og:image" || property === "twitter:image") {
            element.setAttribute("content", this.tags.image);
        }

        if (
            property === "og:description" ||
            property === "twitter:description"
        ) {
            element.setAttribute("content", this.tags.description);
        }
    }
}

export async function onRequest(context) {
    const { request, next, env } = context;

    const url = new URL(request.url);
    // Fixed: Properly escaped the trailing slash regex
    const path = url.pathname.replace(/\/$/, "") || "/";
    const articleId = url.searchParams.get("article");

    const response = await next();
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("text/html")) {
        return response;
    }

    const SCREENSHOT_BASE = "https://pub-5fcbf3326b604a8284068a24252f1585.r2.dev";
    const LEGACY_BASE = "https://pub-07c808f42c4640ceb3db8a0ef856e898.r2.dev";

    let currentTags = {
        title: "Super League - IIIT Kottayam",
        description: "Welcome to the Super League at IIIT Kottayam!",
        image: `${LEGACY_BASE}/wsl.png`
    };

    // Newsletter articles
    if (articleId) {
        try {
            // Fixed: Repaired broken URL string concatenation and backticks
            const supabaseResponse = await fetch(
                `${env.SUPABASE_URL}/rest/v1/newsletter?id=eq.${articleId}&select=image_url`,
                {
                    headers: {
                        apikey: env.SUPABASE_ANON_KEY,
                        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`
                    }
                }
            );

            if (supabaseResponse.ok) {
                const data = await supabaseResponse.json();

                if (data && data.length > 0 && data[0].image_url) {
                    currentTags.title = "Newsletter | Super League";
                    currentTags.image = data[0].image_url;
                }
            }
        } catch (err) {
            console.error("Supabase fetch failed:", err);
        }
    }
    // World Cup shortcut
    else if (path === "/wc") {
        currentTags.title = "FIFA Fantasy League | Super League";
        currentTags.image = `${LEGACY_BASE}/World%20cup.png`;
    }
    // Fantasy page (still uses old image until fantasy.png exists)
    else if (path === "/fantasy") {
        currentTags.title = "FIFA Fantasy League | Super League";
        currentTags.image = `${LEGACY_BASE}/World%20cup.png`;
    }
    // Screenshot-backed routes
    else if (
        [
            "/matches",
            "/standings",
            "/clubs",
            "/statistics",
            "/legends",
            "/rules"
        ].includes(path)
    ) {
        const pageName = path.charAt(1).toUpperCase() + path.slice(2);

        currentTags.title = `${pageName} | Super League`;
        currentTags.image = `${SCREENSHOT_BASE}${path}.png`;
    }

    // Rewriting the HTML payload
    return new HTMLRewriter()
        .on("meta", new MetaTagRewriter(currentTags))
        .transform(response);
}
