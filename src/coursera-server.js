import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { parse } from "node-html-parser";
import puppeteer from "puppeteer";
import { loadEnv } from "./env.js";

const DEFAULT_PER_PAGE = 50;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Coursera API endpoints
const COURSERA_API_BASE = "https://www.coursera.org/api";

const tools = [
  {
    name: "list_enrollments",
    description: "List all courses the user is enrolled in on Coursera, including degree programs.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Maximum number of enrollments to return.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_course",
    description: "Get details for a specific Coursera course by slug.",
    inputSchema: {
      type: "object",
      properties: {
        course_slug: {
          type: "string",
          description: "The course slug (from URL, e.g., 'machine-learning' or 'online-social-media').",
        },
      },
      required: ["course_slug"],
      additionalProperties: false,
    },
  },
  {
    name: "list_course_materials",
    description: "List all modules and materials in a course (uses browser to access protected content).",
    inputSchema: {
      type: "object",
      properties: {
        course_slug: {
          type: "string",
          description: "The course slug.",
        },
      },
      required: ["course_slug"],
      additionalProperties: false,
    },
  },
  {
    name: "get_page_content",
    description: "Get the content of any Coursera page by URL (reading, lecture, assignment, etc). Uses browser to render protected content.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Full Coursera URL (e.g., https://www.coursera.org/learn/online-social-media/supplement/QcAx4/essential-readings-content-integrity)",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "get_reading",
    description: "Get content of a reading/supplement material using browser rendering.",
    inputSchema: {
      type: "object",
      properties: {
        course_slug: {
          type: "string",
          description: "The course slug.",
        },
        item_id: {
          type: "string",
          description: "The reading item ID (e.g., 'QcAx4').",
        },
        item_name: {
          type: "string",
          description: "The item name/slug for the URL (e.g., 'essential-readings-content-integrity').",
        },
      },
      required: ["course_slug", "item_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_lecture",
    description: "Get lecture/video content and transcript.",
    inputSchema: {
      type: "object",
      properties: {
        course_slug: {
          type: "string",
          description: "The course slug.",
        },
        item_id: {
          type: "string",
          description: "The lecture/item ID.",
        },
        item_name: {
          type: "string",
          description: "The item name for the URL.",
        },
      },
      required: ["course_slug", "item_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_assignments",
    description: "List all assignments/quizzes in a course.",
    inputSchema: {
      type: "object",
      properties: {
        course_slug: {
          type: "string",
          description: "The course slug.",
        },
      },
      required: ["course_slug"],
      additionalProperties: false,
    },
  },
  {
    name: "get_assignment",
    description: "Get assignment or quiz content using browser rendering.",
    inputSchema: {
      type: "object",
      properties: {
        course_slug: {
          type: "string",
          description: "The course slug.",
        },
        item_id: {
          type: "string",
          description: "The assignment/quiz item ID.",
        },
        item_name: {
          type: "string",
          description: "The item name for the URL.",
        },
      },
      required: ["course_slug", "item_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_progress",
    description: "Get user's progress in a course.",
    inputSchema: {
      type: "object",
      properties: {
        course_slug: {
          type: "string",
          description: "The course slug.",
        },
      },
      required: ["course_slug"],
      additionalProperties: false,
    },
  },
  {
    name: "list_degree_programs",
    description: "List degree programs the user is enrolled in.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

export function getCourseraConfig() {
  loadEnv();
  const cookies = process.env.COURSERA_COOKIES;
  const cauth = process.env.COURSERA_CAUTH;
  
  if (!cookies && !cauth) {
    throw new Error(
      "Missing COURSERA_COOKIES or COURSERA_CAUTH env var. " +
      "You need to extract your session cookies from your browser."
    );
  }
  
  return { 
    cookies: cookies || `CAUTH=${cauth}`,
    cauth: cauth || extractCauth(cookies)
  };
}

function extractCauth(cookies) {
  if (!cookies) return null;
  const match = cookies.match(/CAUTH=([^;]+)/);
  return match ? match[1] : null;
}

export function createCourseraServer() {
  const { cookies, cauth } = getCourseraConfig();
  
  // Browser instance (lazy initialized)
  let browserPromise = null;

  const server = new Server(
    { name: "coursera-mcp", version: "0.2.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  // Get or create browser instance
  async function getBrowser() {
    if (!browserPromise) {
      browserPromise = puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
    }
    return browserPromise;
  }

  // Create a new page with authentication cookies
  async function createAuthenticatedPage() {
    const browser = await getBrowser();
    const page = await browser.newPage();
    
    // Set cookies
    const cookiesToSet = [];
    if (cauth) {
      cookiesToSet.push({
        name: 'CAUTH',
        value: cauth,
        domain: '.coursera.org',
        path: '/',
        httpOnly: true,
        secure: true,
      });
    }
    
    // Parse additional cookies if provided
    if (cookies && cookies !== `CAUTH=${cauth}`) {
      const cookiePairs = cookies.split(';');
      for (const pair of cookiePairs) {
        const [name, ...valueParts] = pair.trim().split('=');
        if (name && valueParts.length > 0) {
          cookiesToSet.push({
            name: name.trim(),
            value: valueParts.join('=').trim(),
            domain: '.coursera.org',
            path: '/',
          });
        }
      }
    }
    
    if (cookiesToSet.length > 0) {
      await page.setCookie(...cookiesToSet);
    }
    
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 800 });
    
    return page;
  }

  // Fetch page content using Puppeteer
  async function fetchPageContent(url, options = {}) {
    const { 
      waitForSelector = '.rc-CML, .rc-SupplementContent, [data-testid="content"], main',
      timeout = 30000,
      extractText = true
    } = options;
    
    const page = await createAuthenticatedPage();
    
    try {
      console.log(`Fetching: ${url}`);
      await page.goto(url, { 
        waitUntil: 'networkidle2',
        timeout 
      });
      
      // Wait for content to load
      try {
        await page.waitForSelector(waitForSelector, { timeout: 10000 });
      } catch (e) {
        // Content might have different structure, continue anyway
      }
      
      // Additional wait for dynamic content
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract content
      const content = await page.evaluate(() => {
        // Remove navigation, headers, footers
        const removeSelectors = [
          'header', 'footer', 'nav', 
          '[data-testid="navbar"]',
          '.rc-CourseHeader',
          '.rc-LeftNav',
          '.rc-SidebarLayout__sidebar',
        ];
        removeSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => el.remove());
        });
        
        // Try to find main content
        const contentSelectors = [
          '.rc-CML',
          '.rc-SupplementContent', 
          '.rc-ReadingItem',
          '[data-testid="content"]',
          '.rc-LectureContent',
          '.rc-QuizContent',
          'main',
          'article',
          '.rc-ItemPage'
        ];
        
        for (const selector of contentSelectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent.trim().length > 50) {
            return {
              html: el.innerHTML,
              text: el.textContent.trim(),
              selector: selector
            };
          }
        }
        
        // Fallback: get body content
        return {
          html: document.body.innerHTML,
          text: document.body.textContent.trim(),
          selector: 'body'
        };
      });
      
      // Get page title
      const title = await page.title();
      
      // Get URL (might have redirected)
      const finalUrl = page.url();
      
      return {
        title,
        url: finalUrl,
        content: extractText ? content.text : content.html,
        html: content.html,
        foundSelector: content.selector,
      };
      
    } finally {
      await page.close();
    }
  }

  // Helper for simple API requests
  async function courseraFetch(url, options = {}) {
    const headers = {
      "User-Agent": USER_AGENT,
      "Cookie": cookies,
      "Accept": "application/json",
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Coursera API error ${response.status}: ${text.slice(0, 500)}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return response.json();
    }
    return response.text();
  }

  // Tool implementations
  async function listEnrollments(args = {}) {
    const limit = args.limit || DEFAULT_PER_PAGE;
    
    try {
      // Get memberships (includes degree programs)
      const membershipsUrl = `${COURSERA_API_BASE}/memberships.v1?q=me&includes=programs,courses&limit=${limit}`;
      const memberships = await courseraFetch(membershipsUrl).catch(() => null);
      
      // Get program memberships (for degree programs)
      const userId = memberships?.elements?.[0]?.userId;
      let programs = null;
      if (userId) {
        const programsUrl = `${COURSERA_API_BASE}/programMemberships.v2?q=byUser&userId=${userId}`;
        programs = await courseraFetch(programsUrl).catch(() => null);
      }
      
      // Get course details for enrolled courses
      const courseIds = memberships?.elements?.map(m => m.courseId).filter(Boolean) || [];
      let courses = [];
      if (courseIds.length > 0) {
        const coursesUrl = `${COURSERA_API_BASE}/onDemandCourses.v1?ids=${courseIds.join(',')}&fields=id,name,slug,description`;
        const coursesResponse = await courseraFetch(coursesUrl).catch(() => null);
        courses = coursesResponse?.elements || [];
      }

      return {
        memberships: memberships?.elements || [],
        programs: programs?.elements || [],
        courses,
        user_id: userId,
      };
    } catch (error) {
      return { 
        error: error.message,
        hint: "Try refreshing your CAUTH cookie from the browser"
      };
    }
  }

  async function getCourse(args) {
    const { course_slug } = args;
    
    const url = `${COURSERA_API_BASE}/onDemandCourses.v1?q=slug&slug=${encodeURIComponent(course_slug)}&fields=id,name,slug,description,primaryLanguages,instructorIds,partnerIds,workload,photoUrl`;
    
    const response = await courseraFetch(url);
    const course = response?.elements?.[0];
    
    if (!course) {
      throw new Error(`Course not found: ${course_slug}`);
    }

    return course;
  }

  async function listCourseMaterials(args) {
    const { course_slug } = args;
    
    // Use browser to get course materials page
    const url = `https://www.coursera.org/learn/${course_slug}/home/week/1`;
    
    const page = await createAuthenticatedPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Extract course structure
      const materials = await page.evaluate(() => {
        const modules = [];
        
        // Try to find week/module containers
        const weekContainers = document.querySelectorAll('[data-testid="week-container"], .rc-WeekItemName, .rc-ModuleName, .rc-LessonItem');
        
        weekContainers.forEach((container, idx) => {
          const items = [];
          const itemElements = container.querySelectorAll('a[href*="/learn/"], .rc-ItemName');
          
          itemElements.forEach(item => {
            const link = item.closest('a') || item.querySelector('a');
            items.push({
              name: item.textContent?.trim(),
              url: link?.href || null,
              type: link?.href?.includes('/lecture/') ? 'lecture' :
                    link?.href?.includes('/supplement/') ? 'reading' :
                    link?.href?.includes('/quiz/') ? 'quiz' :
                    link?.href?.includes('/exam/') ? 'exam' :
                    link?.href?.includes('/assignment/') ? 'assignment' : 'unknown'
            });
          });
          
          modules.push({
            name: container.querySelector('.rc-WeekItemName, .rc-ModuleName, h2, h3')?.textContent?.trim() || `Module ${idx + 1}`,
            items
          });
        });
        
        // Fallback: get all links
        if (modules.length === 0 || modules.every(m => m.items.length === 0)) {
          const allLinks = document.querySelectorAll('a[href*="/learn/"]');
          const items = [];
          allLinks.forEach(link => {
            const href = link.href;
            if (href.includes('/lecture/') || href.includes('/supplement/') || 
                href.includes('/quiz/') || href.includes('/exam/')) {
              items.push({
                name: link.textContent?.trim(),
                url: href,
                type: href.includes('/lecture/') ? 'lecture' :
                      href.includes('/supplement/') ? 'reading' :
                      href.includes('/quiz/') ? 'quiz' : 'unknown'
              });
            }
          });
          if (items.length > 0) {
            modules.push({ name: 'All Items', items });
          }
        }
        
        return modules;
      });
      
      return {
        course_slug,
        url,
        modules: materials,
      };
      
    } finally {
      await page.close();
    }
  }

  async function getPageContent(args) {
    const { url } = args;
    
    if (!url.includes('coursera.org')) {
      throw new Error('URL must be a Coursera URL');
    }
    
    return fetchPageContent(url);
  }

  async function getReading(args) {
    const { course_slug, item_id, item_name } = args;
    
    // Construct URL
    const slug = item_name || 'reading';
    const url = `https://www.coursera.org/learn/${course_slug}/supplement/${item_id}/${slug}`;
    
    const result = await fetchPageContent(url);
    
    return {
      course_slug,
      item_id,
      ...result
    };
  }

  async function getLecture(args) {
    const { course_slug, item_id, item_name } = args;
    
    const slug = item_name || 'lecture';
    const url = `https://www.coursera.org/learn/${course_slug}/lecture/${item_id}/${slug}`;
    
    const page = await createAuthenticatedPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Extract lecture content and transcript
      const content = await page.evaluate(() => {
        // Get video title
        const title = document.querySelector('.rc-VideoName, h1, .video-name')?.textContent?.trim();
        
        // Get transcript if available
        const transcriptEl = document.querySelector('.rc-Transcript, [data-testid="transcript"]');
        const transcript = transcriptEl?.textContent?.trim();
        
        // Get description
        const description = document.querySelector('.rc-VideoDescription, .video-description')?.textContent?.trim();
        
        // Get video duration
        const duration = document.querySelector('.video-duration, [data-testid="duration"]')?.textContent?.trim();
        
        return {
          title,
          transcript,
          description,
          duration
        };
      });
      
      const pageTitle = await page.title();
      
      return {
        course_slug,
        item_id,
        url,
        page_title: pageTitle,
        ...content
      };
      
    } finally {
      await page.close();
    }
  }

  async function listAssignments(args) {
    const { course_slug } = args;
    
    // Get course ID
    const courseUrl = `${COURSERA_API_BASE}/onDemandCourses.v1?q=slug&slug=${encodeURIComponent(course_slug)}&fields=id`;
    const courseResponse = await courseraFetch(courseUrl);
    const courseId = courseResponse?.elements?.[0]?.id;
    
    if (!courseId) {
      throw new Error(`Course not found: ${course_slug}`);
    }

    // Use browser to get assignments from course page
    const page = await createAuthenticatedPage();
    
    try {
      const url = `https://www.coursera.org/learn/${course_slug}/home/week/1`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const assignments = await page.evaluate(() => {
        const items = [];
        const links = document.querySelectorAll('a[href*="/quiz/"], a[href*="/exam/"], a[href*="/assignment/"], a[href*="/peer/"]');
        
        links.forEach(link => {
          items.push({
            name: link.textContent?.trim(),
            url: link.href,
            type: link.href.includes('/quiz/') ? 'quiz' :
                  link.href.includes('/exam/') ? 'exam' :
                  link.href.includes('/peer/') ? 'peer' : 'assignment'
          });
        });
        
        return items;
      });
      
      return {
        course_id: courseId,
        course_slug,
        assignments: [...new Map(assignments.map(a => [a.url, a])).values()] // dedupe
      };
      
    } finally {
      await page.close();
    }
  }

  async function getAssignment(args) {
    const { course_slug, item_id, item_name } = args;
    
    const slug = item_name || 'quiz';
    // Try different URL patterns
    const urls = [
      `https://www.coursera.org/learn/${course_slug}/quiz/${item_id}/${slug}`,
      `https://www.coursera.org/learn/${course_slug}/exam/${item_id}/${slug}`,
      `https://www.coursera.org/learn/${course_slug}/assignment/${item_id}/${slug}`,
    ];
    
    for (const url of urls) {
      try {
        const result = await fetchPageContent(url);
        if (result.content && result.content.length > 100) {
          return {
            course_slug,
            item_id,
            ...result
          };
        }
      } catch (e) {
        continue;
      }
    }
    
    throw new Error(`Could not find assignment ${item_id} in course ${course_slug}`);
  }

  async function getProgress(args) {
    const { course_slug } = args;
    
    // Use browser to get progress page
    const url = `https://www.coursera.org/learn/${course_slug}/home/welcome`;
    
    const page = await createAuthenticatedPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const progress = await page.evaluate(() => {
        // Look for progress indicators
        const progressBar = document.querySelector('.rc-ProgressBar, [data-testid="progress"]');
        const progressText = document.querySelector('.rc-ProgressText, .progress-percentage');
        const completedItems = document.querySelectorAll('[data-testid="completed"], .completed-item').length;
        const totalItems = document.querySelectorAll('.rc-ItemCard, [data-testid="item"]').length;
        
        return {
          percentage: progressText?.textContent?.trim(),
          completed_items: completedItems,
          total_items: totalItems,
          progress_bar_width: progressBar?.style?.width
        };
      });
      
      return {
        course_slug,
        url,
        ...progress
      };
      
    } finally {
      await page.close();
    }
  }

  async function listDegreePrograms(args = {}) {
    try {
      // Get user's memberships first
      const membershipsUrl = `${COURSERA_API_BASE}/memberships.v1?q=me&limit=100`;
      const memberships = await courseraFetch(membershipsUrl);
      const userId = memberships?.elements?.[0]?.userId;
      
      if (!userId) {
        throw new Error('Could not get user ID');
      }
      
      // Get program memberships
      const programsUrl = `${COURSERA_API_BASE}/programMemberships.v2?q=byUser&userId=${userId}`;
      const programs = await courseraFetch(programsUrl);
      
      return {
        user_id: userId,
        programs: programs?.elements || [],
      };
    } catch (error) {
      return {
        error: error.message,
        hint: "Degree program access requires valid authentication"
      };
    }
  }

  const toolHandlers = {
    list_enrollments: listEnrollments,
    get_course: getCourse,
    list_course_materials: listCourseMaterials,
    get_page_content: getPageContent,
    get_reading: getReading,
    get_lecture: getLecture,
    list_assignments: listAssignments,
    get_assignment: getAssignment,
    get_progress: getProgress,
    list_degree_programs: listDegreePrograms,
  };

  function formatToolResponse(result) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = toolHandlers[name];
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }
    const result = await handler(args || {});
    return formatToolResponse(result);
  });

  // Cleanup on server close
  server.onclose = async () => {
    if (browserPromise) {
      const browser = await browserPromise;
      await browser.close();
    }
  };

  return server;
}
