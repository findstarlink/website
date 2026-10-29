# FindStarlink Docs

User documentation for [FindStarlink](https://findstarlink.com) - the website and the Android/iOS apps that show you when the Starlink satellites will be visible at your location.

The site is built with [Zensical](https://zensical.org/), using a dark, text-only theme to match the app.

## Pages

- **Welcome** - what FindStarlink is and how to get it on web/Android/iOS
- **Finding your location** - search by name, by coordinates, or auto-detect
- **Reading the results** - visibility groups, BRIGHT/DIM, details, sharing
- **Set reminders** - notifications before a sighting (mobile only)
- **Live map** - where Starlink is right now, and why the Results page is what to trust
- **FAQ** - the common questions, shared verbatim by the site and both apps
- **Support the project** - keeping FindStarlink ad-free
- **Contact** - how to reach the developer

## Development

Build and serve locally (requires [Zensical](https://zensical.org/)):

```
zensical serve
```

The built site is written to `site/` (not committed).

To deploy, run:

```
zensical build
```
