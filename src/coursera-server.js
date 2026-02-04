import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { parse } from "node-html-parser";
import { loadEnv } from "./env.js";

const DEFAULT_PER_PAGE = 50;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Coursera GraphQL/API endpoints
const COURSERA_API_BASE = "https://www.coursera.org/api";
const COURSERA_GRAPHQL = "https://www.coursera.org/graphqlBatch";

const tools = [
  {
    name: "list_enrollments",
    description: "List all courses the user is enrolled in on Coursera.",
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
          description: "The course slug (from URL, e.g., 'machine-learning').",
        },
      },
      required: ["course_slug"],
      additionalProperties: false,
    },
  },
  {
    name: "list_course_materials",
    description: "List all modules and materials in a course.",
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
    name: "get_lecture",
    description: "Get details and transcript for a specific lecture/video.",
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
      },
      required: ["course_slug", "item_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_reading",
    description: "Get content of a reading material.",
    inputSchema: {
      type: "object",
      properties: {
        course_slug: {
          type: "string",
          description: "The course slug.",
        },
        item_id: {
          type: "string",
          description: "The reading item ID.",
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
    description: "Get details and questions for a specific assignment or quiz.",
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
    name: "search_courses",
    description: "Search for courses on Coursera.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Maximum number of results.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "list_specializations",
    description: "List specializations/programs the user is enrolled in.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Maximum number of specializations to return.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_deadlines",
    description: "Get upcoming deadlines across all enrolled courses.",
    inputSchema: {
      type: "object",
      properties: {
        days_ahead: {
          type: "integer",
          minimum: 1,
          maximum: 90,
          description: "Number of days ahead to look for deadlines.",
        },
      },
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

  const server = new Server(
    { name: "coursera-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  // Helper to make authenticated requests
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

  // GraphQL batch request
  async function graphqlBatch(operations) {
    const response = await courseraFetch(COURSERA_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Coursera-Application": "learner",
      },
      body: JSON.stringify(operations),
    });
    return response;
  }

  // Tool implementations
  async function listEnrollments(args = {}) {
    const limit = args.limit || DEFAULT_PER_PAGE;
    
    // Use the learner API to get enrollments
    const url = `${COURSERA_API_BASE}/learnerCourseSchedules.v1?q=me&fields=courseId,startDate,endDate&limit=${limit}`;
    
    try {
      const schedules = await courseraFetch(url);
      
      // Also get enrolled courses directly
      const coursesUrl = `${COURSERA_API_BASE}/opencourse.v1/me/enrolledCourses?limit=${limit}`;
      const courses = await courseraFetch(coursesUrl).catch(() => null);
      
      // Get more detailed enrollment info
      const enrollmentsUrl = `${COURSERA_API_BASE}/userEnrollments.v1?q=me&limit=${limit}&fields=courseId,courseName,enrolledTimestamp,completedTimestamp,grade`;
      const enrollments = await courseraFetch(enrollmentsUrl).catch(() => null);

      return {
        schedules: schedules?.elements || [],
        courses: courses?.elements || [],
        enrollments: enrollments?.elements || [],
      };
    } catch (error) {
      // Fallback: scrape from the my courses page
      const html = await courseraFetch("https://www.coursera.org/");
      return { 
        message: "Using fallback method - please check your cookies",
        raw_response_length: html?.length || 0
      };
    }
  }

  async function getCourse(args) {
    const { course_slug } = args;
    
    // Get course info from API
    const url = `${COURSERA_API_BASE}/onDemandCourses.v1?q=slug&slug=${encodeURIComponent(course_slug)}&fields=id,name,slug,description,primaryLanguages,instructorIds,partnerIds,workload,photoUrl,certificateDescription`;
    
    const response = await courseraFetch(url);
    const course = response?.elements?.[0];
    
    if (!course) {
      throw new Error(`Course not found: ${course_slug}`);
    }

    // Try to get additional details
    const detailsUrl = `${COURSERA_API_BASE}/onDemandCourseMaterials.v2/?q=bySlug&slug=${encodeURIComponent(course_slug)}&fields=modules,lessons,items`;
    const details = await courseraFetch(detailsUrl).catch(() => null);

    return {
      ...course,
      materials: details?.elements || [],
    };
  }

  async function listCourseMaterials(args) {
    const { course_slug } = args;
    
    // Get course ID first
    const courseUrl = `${COURSERA_API_BASE}/onDemandCourses.v1?q=slug&slug=${encodeURIComponent(course_slug)}&fields=id`;
    const courseResponse = await courseraFetch(courseUrl);
    const courseId = courseResponse?.elements?.[0]?.id;
    
    if (!courseId) {
      throw new Error(`Course not found: ${course_slug}`);
    }

    // Get materials/modules
    const materialsUrl = `${COURSERA_API_BASE}/onDemandCourseMaterials.v2/?q=byCourse&courseId=${courseId}&fields=modules.v1(name,slug,description,timeCommitment,learningObjectives,optional),lessons.v1(name,slug,description,timeCommitment,optional),items.v1(name,slug,description,timeCommitment,contentSummary,optional)&includes=modules,lessons,items`;
    
    const materials = await courseraFetch(materialsUrl);
    
    // Try alternate endpoint for detailed content
    const contentUrl = `${COURSERA_API_BASE}/onDemandLectureVideos.v1?q=byCourse&courseId=${courseId}&fields=id,name,videoContent`;
    const videos = await courseraFetch(contentUrl).catch(() => null);

    return {
      course_id: courseId,
      materials: materials?.elements || [],
      linked: materials?.linked || {},
      videos: videos?.elements || [],
    };
  }

  async function getLecture(args) {
    const { course_slug, item_id } = args;
    
    // Get lecture content with video URL and subtitles
    const lectureUrl = `${COURSERA_API_BASE}/onDemandLectureVideos.v1/${item_id}?fields=id,videoId,videoContent,subtitles,subtitlesVtt,subtitlesTxt`;
    
    const lecture = await courseraFetch(lectureUrl).catch(() => null);
    
    // Try to get transcript
    const transcriptUrl = `${COURSERA_API_BASE}/onDemandLectureAssets.v1?q=byItem&itemId=${item_id}&fields=typeName,definition`;
    const transcript = await courseraFetch(transcriptUrl).catch(() => null);

    // Get item details
    const itemUrl = `${COURSERA_API_BASE}/onDemandCourseMaterialItems.v2/${item_id}?fields=name,slug,description,timeCommitment,contentSummary`;
    const item = await courseraFetch(itemUrl).catch(() => null);

    return {
      item: item?.elements?.[0] || null,
      lecture: lecture?.elements?.[0] || lecture || null,
      transcript: transcript?.elements || [],
    };
  }

  async function getReading(args) {
    const { course_slug, item_id } = args;
    
    // Get reading content
    const readingUrl = `${COURSERA_API_BASE}/onDemandSupplements.v1/${item_id}?fields=id,content`;
    const reading = await courseraFetch(readingUrl).catch(() => null);

    // Get item details
    const itemUrl = `${COURSERA_API_BASE}/onDemandCourseMaterialItems.v2/${item_id}?fields=name,slug,description,contentSummary`;
    const item = await courseraFetch(itemUrl).catch(() => null);

    // Parse HTML content if present
    let textContent = null;
    if (reading?.content) {
      try {
        const root = parse(reading.content);
        textContent = root.textContent?.trim();
      } catch (e) {
        textContent = reading.content;
      }
    }

    return {
      item: item?.elements?.[0] || null,
      reading: reading || null,
      text_content: textContent,
    };
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

    // Get assessments/quizzes
    const assessmentsUrl = `${COURSERA_API_BASE}/onDemandAssessments.v1?q=byCourse&courseId=${courseId}&fields=id,name,type,passingFraction,gradingWeight`;
    const assessments = await courseraFetch(assessmentsUrl).catch(() => null);

    // Get programming assignments
    const programmingUrl = `${COURSERA_API_BASE}/onDemandProgrammingAssignments.v1?q=byCourse&courseId=${courseId}&fields=id,name,description`;
    const programming = await courseraFetch(programmingUrl).catch(() => null);

    // Get peer assignments
    const peerUrl = `${COURSERA_API_BASE}/onDemandPeerAssignments.v1?q=byCourse&courseId=${courseId}&fields=id,name,description`;
    const peer = await courseraFetch(peerUrl).catch(() => null);

    return {
      course_id: courseId,
      assessments: assessments?.elements || [],
      programming_assignments: programming?.elements || [],
      peer_assignments: peer?.elements || [],
    };
  }

  async function getAssignment(args) {
    const { course_slug, item_id } = args;
    
    // Try different assignment types
    const assessmentUrl = `${COURSERA_API_BASE}/onDemandExamSessions.v1/${item_id}?fields=id,questions,submission`;
    const assessment = await courseraFetch(assessmentUrl).catch(() => null);

    const quizUrl = `${COURSERA_API_BASE}/onDemandQuizzes.v1/${item_id}?fields=id,name,description,passingFraction,questions`;
    const quiz = await courseraFetch(quizUrl).catch(() => null);

    const programmingUrl = `${COURSERA_API_BASE}/onDemandProgrammingAssignments.v1/${item_id}?fields=id,name,description,instructions,starterCode`;
    const programming = await courseraFetch(programmingUrl).catch(() => null);

    return {
      assessment: assessment || null,
      quiz: quiz || null,
      programming: programming || null,
    };
  }

  async function getProgress(args) {
    const { course_slug } = args;
    
    // Get course ID
    const courseUrl = `${COURSERA_API_BASE}/onDemandCourses.v1?q=slug&slug=${encodeURIComponent(course_slug)}&fields=id`;
    const courseResponse = await courseraFetch(courseUrl);
    const courseId = courseResponse?.elements?.[0]?.id;
    
    if (!courseId) {
      throw new Error(`Course not found: ${course_slug}`);
    }

    // Get progress
    const progressUrl = `${COURSERA_API_BASE}/onDemandCourseProgress.v1/${courseId}?fields=overallProgress,moduleProgress,itemProgress`;
    const progress = await courseraFetch(progressUrl).catch(() => null);

    // Get grades
    const gradesUrl = `${COURSERA_API_BASE}/onDemandGrades.v1?q=byCourse&courseId=${courseId}&fields=passingState,grade,overallProgress`;
    const grades = await courseraFetch(gradesUrl).catch(() => null);

    return {
      course_id: courseId,
      progress: progress || null,
      grades: grades?.elements || [],
    };
  }

  async function searchCourses(args) {
    const { query, limit = 20 } = args;
    
    const searchUrl = `${COURSERA_API_BASE}/search/all?query=${encodeURIComponent(query)}&limit=${limit}&fields=name,slug,photoUrl,partnerIds,workload,description`;
    const results = await courseraFetch(searchUrl);
    
    return {
      query,
      results: results?.elements || [],
      total: results?.paging?.total || 0,
    };
  }

  async function listSpecializations(args = {}) {
    const limit = args.limit || DEFAULT_PER_PAGE;
    
    const url = `${COURSERA_API_BASE}/onDemandSpecializations.v1?q=enrolled&limit=${limit}&fields=id,name,slug,description,logo,partnerIds`;
    const specializations = await courseraFetch(url).catch(() => null);

    return {
      specializations: specializations?.elements || [],
    };
  }

  async function getDeadlines(args = {}) {
    const daysAhead = args.days_ahead || 14;
    
    const now = new Date();
    const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    
    const url = `${COURSERA_API_BASE}/userScheduledItems.v1?q=upcoming&startTime=${now.toISOString()}&endTime=${future.toISOString()}&fields=itemId,itemType,deadline,courseId,courseName`;
    const deadlines = await courseraFetch(url).catch(() => null);

    return {
      days_ahead: daysAhead,
      deadlines: deadlines?.elements || [],
    };
  }

  const toolHandlers = {
    list_enrollments: listEnrollments,
    get_course: getCourse,
    list_course_materials: listCourseMaterials,
    get_lecture: getLecture,
    get_reading: getReading,
    list_assignments: listAssignments,
    get_assignment: getAssignment,
    get_progress: getProgress,
    search_courses: searchCourses,
    list_specializations: listSpecializations,
    get_deadlines: getDeadlines,
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

  return server;
}
