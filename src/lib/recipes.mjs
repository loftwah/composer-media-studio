// MIT. Original, editable starting recipes. No third-party branding or copy.
// Every control states how it is applied: provider-native or prompt instruction.
// A recipe is a starting point, never hidden billed work.

export const builtinRecipes = [
  {
    slug: "editorial-print",
    title: "Editorial print",
    description:
      "A paper-cut editorial illustration with warm ground, ink line and space for a headline.",
    kind: "image",
    model: "studio-print",
    promptTemplate:
      "Flat paper-cut editorial illustration about {subject}. Warm ivory paper ground, graphite ink outlines, layered cut-paper shapes in {palette}, screenprint grain, one clear focal point, subtle deckled edges, no logos, no photorealistic people. Integrate accurate, legible lettering when it serves the brief.",
    controls: [
      { key: "subject", label: "Subject", type: "text", default: "a ceramicist shaping a bowl by hand", application: "prompt" },
      { key: "palette", label: "Palette", type: "select", options: ["burnt orange and bone", "deep teal and sand", "graphite and ochre"], default: "burnt orange and bone", application: "prompt" },
      { key: "aspect", label: "Frame", type: "select", options: ["portrait", "square", "landscape"], default: "portrait", application: "provider-native" },
    ],
    negativePrompt: "",
  },
  {
    slug: "product-plate",
    title: "Product plate",
    description:
      "One object, plainly lit, with believable contact shadow and a clean catalogue frame.",
    kind: "image",
    model: "studio-draft",
    promptTemplate:
      "Studio product photograph of {product}. Single soft key light from the left, subtle contact shadow, warm grey seamless background, tactile material detail, centred composition, shallow depth of field, no props, no packaging logos, no hands. Keep any requested lettering accurate and legible.",
    controls: [
      { key: "product", label: "Product", type: "text", default: "a matte burnt-orange stoneware cup", application: "prompt" },
      { key: "aspect", label: "Frame", type: "select", options: ["square", "portrait", "landscape"], default: "square", application: "provider-native" },
    ],
    negativePrompt: "",
  },
  {
    slug: "cinematic-still",
    title: "Cinematic still",
    description:
      "A wide screenprinted frame with motivated light and a strong single accent.",
    kind: "image",
    model: "studio-film",
    promptTemplate:
      "Screenprinted cinematic frame: {scene}. Graphic ink shading, deep readable shadows, warm amber practical light against cool ink, limited palette with one burnt orange accent, visible paper grain, wide 2.39:1 composition, no watermark, no photorealistic faces. Include accurate, legible lettering when it serves the scene.",
    controls: [
      { key: "scene", label: "Scene", type: "text", default: "a lone lighthouse keeper crossing a wet stone path at dusk", application: "prompt" },
      { key: "aspect", label: "Frame", type: "select", options: ["wide", "landscape"], default: "wide", application: "provider-native" },
    ],
    negativePrompt: "",
  },
  {
    slug: "reference-variation",
    title: "Reference variation",
    description:
      "Use a selected still for palette, ink quality and subject, then make one deliberate change in a new square frame.",
    kind: "image",
    model: "studio-detail",
    promptTemplate:
      "Use the reference image as creative direction: keep its palette, ink line and paper-cut character. Make a new square editorial illustration of the same subject type, with one deliberate change: {change}. Keep any lettering accurate and legible; no logos, no watermark.",
    controls: [
      { key: "change", label: "Change", type: "text", default: "move the light to late afternoon with a longer shadow", application: "prompt" },
      { key: "aspect", label: "Frame", type: "hidden", default: "square", application: "provider-native" },
      { key: "reference", label: "Reference image", type: "reference", application: "provider-native" },
    ],
    negativePrompt: "",
  },
  {
    slug: "animate-a-still",
    title: "Animate a still",
    description:
      "Turn one still into a short clip with a single, physically plausible camera move.",
    kind: "video",
    model: "hailuo-standard",
    promptTemplate:
      "Subtle cinematic motion: {motion}. Keep the subject and graphic style of the first frame. Natural physics, no morphing, no camera shake. Keep lettering legible when it appears.",
    controls: [
      { key: "motion", label: "Motion", type: "select", options: ["slow push in", "gentle parallax left", "soft drift upward", "still air with moving light"], default: "slow push in", application: "prompt" },
      { key: "duration", label: "Clip length", type: "select", options: ["6", "10"], default: "6", application: "provider-native" },
      { key: "reference", label: "Still to animate", type: "reference", application: "provider-native" },
    ],
    negativePrompt: "",
  },
];

export function builtinRecipe(slug) {
  return builtinRecipes.find((recipe) => recipe.slug === slug) ?? null;
}

export function renderPrompt(recipe, values) {
  return recipe.promptTemplate.replace(/\{(\w+)\}/g, (_, key) => {
    const control = recipe.controls.find((item) => item.key === key);
    const value = values[key] ?? control?.default ?? "";
    return String(value).slice(0, 600);
  });
}

export function projectRecipes(projectId, rows) {
  return [
    ...builtinRecipes.map((recipe) => ({
      id: `builtin:${recipe.slug}`,
      slug: recipe.slug,
      title: recipe.title,
      description: recipe.description,
      kind: recipe.kind,
      model: recipe.model,
      promptTemplate: recipe.promptTemplate,
      controls: recipe.controls,
      version: 1,
      builtin: true,
    })),
    ...rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      kind: row.kind,
      promptTemplate: row.prompt_template,
      controls: JSON.parse(row.controls_json),
      version: row.version,
      builtin: false,
    })),
  ];
}
