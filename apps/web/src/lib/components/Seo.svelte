<script lang="ts">
interface Props {
  title: string
  description: string
  path: string
  noIndex?: boolean
}

let { title, description, path, noIndex = false }: Props = $props()

const origin = 'https://pollo.tobiasmarion.com'
const image = `${origin}/pollo-social-card.png`
const imageAlt = 'Pollo in white on a solid black background.'
const canonical = $derived(new URL(path, origin).toString())
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta
    name="robots"
    content={noIndex ? 'noindex, nofollow, noarchive' : 'index, follow, max-image-preview:large'}
  />
  <link rel="canonical" href={canonical} />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Pollo" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={canonical} />
  <meta property="og:image" content={image} />
  <meta property="og:image:secure_url" content={image} />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content={imageAlt} />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={title} />
  <meta name="twitter:description" content={description} />
  <meta name="twitter:image" content={image} />
  <meta name="twitter:image:alt" content={imageAlt} />
</svelte:head>
