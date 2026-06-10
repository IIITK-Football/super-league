class MetaTagRewriter {
    constructor(tags) {
        this.tags = tags;
    }

    element(element) {
        const property = element.getAttribute("property") || element.getAttribute("name");

        // Match specific tags
        if (["og:title", "twitter:title"].includes(property)) {
            element.setAttribute("content", this.tags.title);
        }
        if (["og:image", "twitter:image"].includes(property)) {
            element.setAttribute("content", this.tags.image);
        }
        if (["og:description", "twitter:description"].includes(property)) {
            element.setAttribute("content", this.tags.description);
        }
    }
}

export async function onRequest(context) {
    const { request, next, env } = context;
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    const articleId = url.searchParams.get("article");

    const response = await next();
    if (!response.headers.get("content-type")?.includes("text/html")) return response;

    const SCREENSHOT_BASE = "https://your-new-r2-public-url.dev"; // UPDATE THIS
    const LEGACY_BASE = "https://pub-07c808f42c4640ceb3db8a0ef856e898.r2.dev";

    let currentTags = {
        title: "Super League - IIIT Kottayam",
        description: "Welcome to the Super League at IIIT Kottayam!",
        image: `${LEGACY_BASE}/wsl.png`
    };

    // Newsletter logic
    if (articleId) {
        try {
            const supabaseResponse = await fetch(
                `${env.SUPABASE_URL}/rest/v1/newsletter?id=eq.${articleId}&select=image_url`,
                { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` } }
            );
            const data = await supabaseResponse.json();
            if (data?.[0]?.image_url) {
                currentTags.title = "Newsletter | Super League";
                currentTags.image = data[0].image_url;
            }
        } catch (err) { console.error("Supabase failed:", err); }
    }
    // Static Routes
    else if (path === "/wc" || path === "/fantasy") {
        currentTags.title = "FIFA Fantasy League | Super League";
        currentTags.image = `${LEGACY_BASE}/World%20cup.png`;
    }
    // Dynamic Screenshot Routes
    else {
        const screenshotRoutes = ["/matches", "/standings", "/clubs", "/statistics", "/legends", "/rules"];
        if (screenshotRoutes.includes(path)) {
            const pageName = path.slice(1).charAt(0).toUpperCase() + path.slice(2);
            currentTags.title = `${pageName} | Super League`;
            currentTags.image = `${SCREENSHOT_BASE}${path}.png`;
        }
    }

    return new HTMLRewriter()
        .on("meta", new MetaTagRewriter(currentTags))
        .transform(response);
}
