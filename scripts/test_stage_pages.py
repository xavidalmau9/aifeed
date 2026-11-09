#!/usr/bin/env python3
"""Unit and fixture tests for the Pages publish staging rules."""
import datetime
import json
import os
import shutil
import subprocess
import tempfile
import unittest

import stage_pages as sp
import analytics_snippet as az

DAY = 24 * 3600


class DecideTests(unittest.TestCase):
    def test_recent_reel_kept_and_old_reel_omitted(self):
        self.assertEqual(sp.decide("videos/reels/new.mp4", 2 * DAY, False), (True, "video-recent"))
        self.assertEqual(sp.decide("videos/reels/new_cover.jpg", 2 * DAY, False), (True, "video-recent"))
        self.assertEqual(sp.decide("videos/reels/old.mp4", 10 * DAY, False), (False, "video-old"))
        self.assertEqual(sp.decide("videos/aifeed_branded_1.mp4", 200 * DAY, False), (False, "video-old"))

    def test_undated_video_kept_so_a_new_reel_is_not_dropped(self):
        self.assertEqual(sp.decide("videos/reels/just-committed.mp4", None, False), (True, "video-undated"))

    def test_page_image_kept_even_when_old(self):
        rel = "images/aifeed_story_20200101_am.png"
        self.assertEqual(sp.decide(rel, 400 * DAY, True), (True, "image-page"))

    def test_old_unreferenced_image_omitted_recent_story_kept(self):
        self.assertEqual(sp.decide("images/huge-old.png", 100 * DAY, False), (False, "image-old"))
        self.assertEqual(sp.decide("images/aifeed_x_20261107_am_story.png", 1 * DAY, False), (True, "image-recent"))
        self.assertEqual(sp.decide("images/aifeed_x_20261107_am_s2.png", 1 * DAY, False), (True, "image-recent"))

    def test_end_card_and_site_files_always_kept(self):
        self.assertEqual(sp.decide("images/aifeed_endslide.png", 500 * DAY, False), (True, "image-page"))
        self.assertEqual(sp.decide(".nojekyll", None, False), (True, "site"))
        self.assertEqual(sp.decide("llms.txt", None, False), (True, "site"))
        self.assertEqual(sp.decide("llms-full.txt", None, False), (True, "site"))
        self.assertEqual(sp.decide("sitemap.xml", None, False), (True, "site"))
        self.assertEqual(sp.decide("news/some-story/index.html", 40 * DAY, False), (True, "site"))
        self.assertEqual(sp.decide("thumbs/cover-720.webp", 40 * DAY, False), (True, "site"))

    def test_dev_trees_omitted(self):
        self.assertEqual(sp.decide("graphics/huge.html", 1 * DAY, False), (False, "dev"))
        self.assertEqual(sp.decide("automation/actions/pipeline.js", 1 * DAY, False), (False, "dev"))
        self.assertEqual(sp.decide("CLAUDE.md", 1 * DAY, False), (False, "dev"))
        self.assertEqual(sp.decide("_includes/analytics.html", 1 * DAY, False), (False, "dev"))

    def test_boundary_is_three_days(self):
        self.assertEqual(sp.decide("videos/reels/edge.mp4", sp.RETAIN_SECONDS, False)[0], True)
        self.assertEqual(sp.decide("videos/reels/edge.mp4", sp.RETAIN_SECONDS + 1, False)[0], False)


class VideoIndexTests(unittest.TestCase):
    def test_drops_unpublished_archive_and_adds_recent_reel(self):
        entries = [
            {"filename": "old.mp4", "url": "https://aifeed.run/videos/old.mp4", "title": "Old", "date": "2026-01-01T00:00:00Z"},
            {"filename": "new.mp4", "url": "https://aifeed.run/videos/new.mp4", "title": "New", "date": "2026-11-07T00:00:00Z"},
        ]
        kept = ["videos/new.mp4", "videos/reels/protesters.mp4", "videos/reels/protesters_cover.jpg"]
        posts = {"protesters": {"headline": "Protesters", "summary": "A summary", "publishedAt": "2026-11-06T22:00:00Z", "sourceUrl": "https://example.com/a"}}
        out = sp.publish_video_index(entries, kept, posts, {"videos/reels/protesters.mp4": 1})
        urls = [e["url"] for e in out]
        self.assertIn("https://aifeed.run/videos/new.mp4", urls)
        self.assertNotIn("https://aifeed.run/videos/old.mp4", urls)
        reel = next(e for e in out if e["url"].endswith("/videos/reels/protesters.mp4"))
        self.assertEqual(reel["title"], "Protesters")
        self.assertEqual(reel["caption"], "A summary")
        self.assertTrue(out[0]["date"] >= out[-1]["date"])


class StageFixtureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="aifeed-pages-")
        self.repo = os.path.join(self.tmp, "repo")
        self.dest = os.path.join(self.tmp, "publish")
        os.makedirs(self.repo)
        subprocess.check_call(["git", "init", "-q"], cwd=self.repo)
        env = os.environ.copy()
        env.update({
            "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
            "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com",
        })
        self.env = env

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, rel, data):
        path = os.path.join(self.repo, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data if isinstance(data, bytes) else data.encode())

    def commit(self, msg, when):
        env = self.env.copy()
        env["GIT_AUTHOR_DATE"] = when
        env["GIT_COMMITTER_DATE"] = when
        subprocess.check_call(["git", "add", "-A"], cwd=self.repo, env=env)
        subprocess.check_call(["git", "commit", "-q", "-m", msg], cwd=self.repo, env=env)

    def test_fixture_repo_keeps_pages_and_recent_reels_only(self):
        # The real repo has this sentinel. A fixture without it skips that guard.
        self.write("index.html", "<html>home images/cover.png</html>")
        self.write("sitemap.xml", "<urlset></urlset>")
        self.write("llms.txt", "llms")
        self.write("llms-full.txt", "full")
        self.write("CNAME", "aifeed.run\n")
        self.write(".nojekyll", "")
        self.write("robots.txt", "User-agent: *\n")
        self.write("feed.xml", "<rss></rss>")
        self.write("404.html", "missing")
        self.write("post.html", "template")
        self.write("news/protesters-break-into-microsoft-data-center/index.html",
                   '<img src="https://aifeed.run/images/cover.png">')
        self.write("images/cover.png", b"cover-bytes")
        self.write("images/aifeed_endslide.png", b"end")
        self.write("images/old-unused.png", b"old-unused-bytes")
        self.write("images/fresh_story.png", b"story")
        self.write("graphics/embedded.html", b"x" * 5000)
        self.write("videos/old.mp4", b"old-video")
        self.write("videos/reels/fresh.mp4", b"fresh-video")
        self.write("videos/reels/fresh_cover.jpg", b"cover")
        self.write("videos/videos-index.json", json.dumps([
            {"filename": "old.mp4", "url": "https://aifeed.run/videos/old.mp4", "title": "Old", "date": "2020-01-01T00:00:00Z"}
        ]))
        self.write("_posts/posts-index.json", json.dumps([
            {"slug": "fresh", "headline": "Fresh reel", "summary": "Sum", "publishedAt": "2026-11-07T12:00:00Z",
             "imageUrl": "https://aifeed.run/images/cover.png", "image": "images/cover.png"}
        ]))
        self.commit("old media", "2020-01-01T00:00:00+00:00")
        # Touch the recent media in a new commit. cover.png stays at the old commit
        # but is referenced, so it must still publish.
        self.write("videos/reels/fresh.mp4", b"fresh-video-2")
        self.write("videos/reels/fresh_cover.jpg", b"cover-2")
        self.write("images/fresh_story.png", b"story-2")
        self.commit("recent reel", "2026-11-07T12:00:00+00:00")

        # Sentinel file absent: stage() only enforces it when the file exists.
        # Pin "now" so the 2026 commit is inside the retention window and the 2020 one is not.
        now = datetime.datetime(2026, 11, 7, 18, 0, tzinfo=datetime.timezone.utc).timestamp()
        # Bypass sentinel by not creating the branded file. stage() still needs a non-shallow repo.
        report = sp.stage(self.repo, self.dest, now=now)
        self.assertTrue(os.path.isfile(os.path.join(self.dest, "news/protesters-break-into-microsoft-data-center/index.html")))
        self.assertTrue(os.path.isfile(os.path.join(self.dest, "images/cover.png")))
        self.assertTrue(os.path.isfile(os.path.join(self.dest, "images/aifeed_endslide.png")))
        self.assertTrue(os.path.isfile(os.path.join(self.dest, "images/fresh_story.png")))
        self.assertTrue(os.path.isfile(os.path.join(self.dest, "videos/reels/fresh.mp4")))
        self.assertTrue(os.path.isfile(os.path.join(self.dest, "llms.txt")))
        self.assertTrue(os.path.isfile(os.path.join(self.dest, "llms-full.txt")))
        self.assertTrue(os.path.isfile(os.path.join(self.dest, "sitemap.xml")))
        self.assertFalse(os.path.exists(os.path.join(self.dest, "videos/old.mp4")))
        self.assertFalse(os.path.exists(os.path.join(self.dest, "images/old-unused.png")))
        self.assertFalse(os.path.exists(os.path.join(self.dest, "graphics/embedded.html")))
        index = json.load(open(os.path.join(self.dest, "videos/videos-index.json"), encoding="utf-8"))
        urls = [e["url"] for e in index]
        self.assertIn("https://aifeed.run/videos/reels/fresh.mp4", urls)
        self.assertNotIn("https://aifeed.run/videos/old.mp4", urls)
        self.assertLess(report["bytes"], sp.MAX_BYTES)
        # Repo files were not deleted.
        self.assertTrue(os.path.isfile(os.path.join(self.repo, "videos/old.mp4")))
        self.assertTrue(os.path.isfile(os.path.join(self.repo, "images/old-unused.png")))

    def test_published_about_faq_privacy_contain_each_tag_once(self):
        home = "<!DOCTYPE html><html><head>\n" + az.snippet_body() + "\n<title>Home</title></head><body>home</body></html>"
        self.write("index.html", home)
        bare = "<!DOCTYPE html><html><head><title>{title}</title></head><body><h1>{title}</h1></body></html>"
        self.write("about/index.html", bare.format(title="About"))
        self.write("faq/index.html", bare.format(title="FAQ"))
        self.write("privacy/index.html", bare.format(title="Privacy"))
        self.write("404.html", "<!DOCTYPE html><html><head><title>Missing</title></head><body>missing</body></html>")
        self.write("sitemap.xml", "<urlset></urlset>")
        self.write("llms.txt", "llms")
        self.write("llms-full.txt", "full")
        self.write("CNAME", "aifeed.run\n")
        self.write(".nojekyll", "")
        self.write("images/aifeed_endslide.png", b"end")
        self.commit("pages", "2026-11-07T12:00:00+00:00")
        now = datetime.datetime(2026, 11, 7, 18, 0, tzinfo=datetime.timezone.utc).timestamp()
        sp.stage(self.repo, self.dest, now=now)

        def counts(rel):
            with open(os.path.join(self.dest, rel), encoding="utf-8") as fh:
                text = fh.read()
            return (
                text.count(az.CLARITY_ID),
                text.count("https://www.clarity.ms/tag/"),
                text.count("https://www.googletagmanager.com/gtag/js?id=" + az.GA_ID),
                text.count("gtag('config', '%s')" % az.GA_ID),
            )

        once = (1, 1, 1, 1)
        for rel in ("index.html", "about/index.html", "faq/index.html", "privacy/index.html", "404.html"):
            self.assertEqual(counts(rel), once, rel)
        self.assertFalse(os.path.exists(os.path.join(self.dest, "_includes", "analytics.html")))
        with open(os.path.join(self.dest, "about/index.html"), encoding="utf-8") as fh:
            about = fh.read()
        self.assertIn("<h1>About</h1>", about)
        self.assertIn("<title>About</title>", about)


class AnalyticsSnippetTests(unittest.TestCase):
    def test_inserts_each_tag_once_and_is_idempotent(self):
        html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body><h1>About</h1></body></html>"
        once = az.inject(html)
        self.assertEqual(once.count(az.CLARITY_ID), 1)
        self.assertEqual(once.count("https://www.clarity.ms/tag/"), 1)
        self.assertEqual(once.count("https://www.googletagmanager.com/gtag/js?id=" + az.GA_ID), 1)
        self.assertEqual(once.count("gtag('config', '%s')" % az.GA_ID), 1)
        self.assertIn("<h1>About</h1>", once)
        self.assertEqual(az.inject(once), once)

    def test_homepage_and_story_template_are_not_tagged_twice(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        for rel in ("index.html", "post.html", "news/index.html"):
            with open(os.path.join(root, rel), encoding="utf-8") as fh:
                html = fh.read()
            self.assertEqual(az.inject(html), html)
            self.assertEqual(html.count(az.CLARITY_ID), 1)
            self.assertEqual(html.count("https://www.googletagmanager.com/gtag/js?id=" + az.GA_ID), 1)

    def test_marker_and_drifted_ids_collapse_to_the_shared_snippet(self):
        marked = "<!DOCTYPE html><html><head>\n<!-- AIFEED_ANALYTICS -->\n<title>FAQ</title></head><body></body></html>"
        out = az.inject(marked)
        self.assertNotIn("AIFEED_ANALYTICS", out)
        self.assertEqual(out.count(az.CLARITY_ID), 1)
        self.assertEqual(out.count("https://www.googletagmanager.com/gtag/js?id=" + az.GA_ID), 1)
        self.assertEqual(az.inject(out), out)

        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, "index.html"), encoding="utf-8") as fh:
            drifted = fh.read()
        drifted = drifted.replace(az.CLARITY_ID, "driftedid1").replace(az.GA_ID, "G-DRIFTEDID")
        fixed = az.inject(drifted)
        self.assertNotIn("driftedid1", fixed)
        self.assertNotIn("G-DRIFTEDID", fixed)
        self.assertEqual(fixed.count(az.CLARITY_ID), 1)
        self.assertEqual(fixed.count("https://www.googletagmanager.com/gtag/js?id=" + az.GA_ID), 1)
        self.assertEqual(fixed.count("gtag('config', '%s')" % az.GA_ID), 1)
        self.assertIn("<title>AIFeed.run AI News", fixed)
        self.assertEqual(az.inject(fixed), fixed)

    def test_header_element_is_not_a_head(self):
        html = "<html><body><header>Hi</header></body></html>"
        self.assertEqual(az.inject(html), html)

    def test_graphic_card_without_head_is_left_alone(self):
        html = "<!doctype html><html><body><div class=\"c\"></div></body></html>"
        self.assertEqual(az.inject(html), html)


if __name__ == "__main__":
    unittest.main()
