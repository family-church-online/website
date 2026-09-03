import type { Collection } from "tinacms";

export const GlobalConfigCollection: Collection = {
  name: "config",
  label: "Global Config",
  path: "src/content/config",
  format: "json",
  ui: {
    global: true,
  },
  fields: [
    {
      name: "seo",
      label: "Site Identity & SEO",
      description:
        "Site-wide identity. These values appear on every page — the Site Name is shown in the header navigation and used as the default browser title; the Description is the default for search results and social shares.",
      type: "object",
      fields: [
        {
          name: "title",
          label: "Site Name",
          type: "string",
          required: true,
          description:
            "Shown in the header navigation on every page. Lives in Global Config because it's the same site-wide — each page sets its own browser title via the Meta Title field on the page, and this Site Name is used as the fallback if a page is ever missing one.",
        },
        {
          name: "description",
          label: "Default Meta Description (SEO)",
          type: "string",
          required: true,
          description:
            "Default description shown in search results and social-sharing previews when a page does not provide its own.",
        },
        {
          name: "siteOwner",
          label: "Site Owner (shown in footer)",
          required: true,
          type: "string",
          description: "Your name or company name. Displayed in the site footer.",
          ui: {
            defaultValue: "Your name here"
          },
        },
        {
          name: 'logo',
          label: 'Logo',
          type: 'image',
          ui: { uploadDir: () => '/images/site' },
          description: 'Shown next to the Site Name in the header navigation.',
        },
        {
          name: 'whatsappPhone',
          label: 'WhatsApp Phone Number',
          type: 'string',
          description: 'Used for the WhatsApp chat button. Include country code, no + or spaces (e.g. 27821234567).',
        },
        //Add more site settings here...
      ],
    },
    {
      name: "nav",
      label: "Navigation Menu",
      description:
        "Links shown in the header navigation. Reorder, add, or remove items below. The Site Name shown to the left of these links is set in Site Identity & SEO above.",
      type: "object",
      list: true,
      ui: {
        itemProps: (item) => {
          return {
            label: item.title
          };
        },
      },
      fields: [
        {
          name: "title",
          label: "Link Label",
          description: "The text shown in the nav for this link.",
          type: "string",
          required: true
        },
        {
          name: "link",
          label: "Link URL",
          description: "Where this nav item points (e.g. /about or https://example.com). Leave empty if this item only opens a submenu.",
          type: "string",
        },
        {
          name: "children",
          label: "Submenu Items",
          description: "Optional. Add items here to create a dropdown under this nav link.",
          type: "object",
          list: true,
          ui: {
            itemProps: (item) => ({ label: item.title }),
          },
          fields: [
            {
              name: "title",
              label: "Label",
              type: "string",
              required: true,
            },
            {
              name: "link",
              label: "URL",
              type: "string",
              required: true,
            },
          ],
        },
      ]
    },
    {
      name: "contactLinks",
      label: "Contact Links",
      type: "object",
      list: true,
      ui: {
        itemProps: (item) => {
          return {
            label: item.title
          }
        },
      },
      fields: [
        {
          name: "title",
          label: "Title",
          type: "string"
        },
        {
          name: "link",
          label: "Link",
          type: "string"
        },
        {
          name: "icon",
          label: "Icon",
          description: "Any Tabler icon name, e.g. tabler:brand-x, tabler:book-2, tabler:brand-github. Browse at https://icones.js.org/collection/tabler",
          type: "string"
        }
      ],
    },
    {
      name: "banner",
      label: "Announcement Banner",
      description: "A thin strip shown at the very top of every page. Toggle it on/off without losing the text.",
      type: "object",
      fields: [
        {
          name: "enabled",
          label: "Show Banner",
          type: "boolean",
        },
        {
          name: "text",
          label: "Banner Text",
          type: "string",
        },
        {
          name: "link",
          label: "Link URL",
          description: "Optional. The banner text becomes a clickable link.",
          type: "string",
        },
      ],
    },
    {
      name: "auth",
      label: "Member Access",
      description: "Messages shown on the sign-in and access pages, and in the magic-link email sent to members.",
      type: "object",
      fields: [
        {
          name: "email",
          label: "Sign-in Email",
          type: "object",
          fields: [
            {
              name: "subject",
              label: "Subject Line",
              type: "string",
            },
            {
              name: "intro",
              label: "Intro Text",
              type: "string",
              description: "First line of the email body, before the sign-in link.",
            },
            {
              name: "linkText",
              label: "Link Button Text",
              type: "string",
            },
            {
              name: "footer",
              label: "Footer Note",
              type: "string",
            },
          ],
        },
        {
          name: "loginPage",
          label: "Sign-in Page",
          type: "object",
          fields: [
            { name: "heading", label: "Heading", type: "string" },
            { name: "body", label: "Body Text", type: "string" },
            { name: "footer", label: "Footer Note", type: "string", description: "Small note shown below the form." },
          ],
        },
        {
          name: "checkEmailPage",
          label: "Check Email Page",
          type: "object",
          fields: [
            { name: "heading", label: "Heading", type: "string" },
            { name: "body", label: "Body Text", type: "string" },
          ],
        },
        {
          name: "deniedPage",
          label: "Access Denied Page",
          type: "object",
          fields: [
            { name: "heading", label: "Heading", type: "string" },
            { name: "body", label: "Body Text", type: "string" },
          ],
        },
        {
          name: "expiredPage",
          label: "Link Expired Page",
          type: "object",
          fields: [
            { name: "heading", label: "Heading", type: "string" },
            { name: "body", label: "Body Text", type: "string" },
          ],
        },
      ],
    },
    {
      name: 'kidsChurch',
      label: 'Kids Church Ministry',
      description: 'Names and age ranges shown on the Kids Church landing page and lesson headers.',
      type: 'object',
      fields: [
        {
          name: 'ministryName',
          label: 'Ministry Name',
          type: 'string',
          description: 'e.g. "Bravehearts" or "Kids Church" — shown as the main heading.',
        },
        {
          name: 'preschoolLabel',
          label: 'Pre-School Group Name',
          type: 'string',
          description: 'e.g. "Tiny Tots" or "Pre-School"',
        },
        {
          name: 'preschoolAges',
          label: 'Pre-School Age Range',
          type: 'string',
          description: 'e.g. "Ages 3–5"',
        },
        {
          name: 'juniorLabel',
          label: 'Junior Group Name',
          type: 'string',
          description: 'e.g. "Explorers" or "Junior"',
        },
        {
          name: 'juniorAges',
          label: 'Junior Age Range',
          type: 'string',
          description: 'e.g. "Ages 6–9"',
        },
        {
          name: 'seniorLabel',
          label: 'Senior Group Name',
          type: 'string',
          description: 'e.g. "Champions" or "Senior"',
        },
        {
          name: 'seniorAges',
          label: 'Senior Age Range',
          type: 'string',
          description: 'e.g. "Ages 10–12"',
        },
      ],
    },
    // Add other config fields here...
  ]
}
