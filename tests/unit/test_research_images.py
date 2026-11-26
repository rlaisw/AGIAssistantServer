"""Image exposure for image-rich answers (spec 049): alt capture on section
blocks and the flat per-page image list derived from those sections."""

from pathlib import Path

from agentic_rag_mcp.search.web.research import (
    extract_sections,
    flatten_images,
    sections_to_text,
)
from agentic_rag_mcp.server import _img_srcs

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "research"
PAGE_URL = "https://docs.example/guide"


def _html(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


def _sections(name):
    sections, _ = extract_sections(_html(name), PAGE_URL, 6000)
    return sections


def _img_blocks(sections):
    return [b for sec in sections for b in sec["blocks"] if b["type"] == "img"]


def test_img_block_carries_source_alt():
    blocks = _img_blocks(_sections("ordered.html"))
    assert blocks[0]["alt"] == "Message trace search form in the Exchange admin center"


def test_img_block_alt_defaults_empty():
    blocks = _img_blocks(_sections("gallery.html"))
    assert any(b["alt"] == "" for b in blocks)


def test_images_flat_list_preserves_document_order():
    images = flatten_images(_sections("ordered.html"))
    assert [i["url"] for i in images] == [
        "https://docs.example/img/trace-step1.png",
        "https://cdn.example.com/img/trace-results.png",
    ]


def test_images_flat_list_carries_heading():
    images = flatten_images(_sections("ordered.html"))
    assert images[0]["heading"] == "Trace a message"
    assert images[1]["heading"] == "Understand the results"


def test_images_absolute_urls():
    images = flatten_images(_sections("ordered.html"))
    assert all(i["url"].startswith("https://") for i in images)


def test_data_uri_image_absent():
    images = flatten_images(_sections("dirty.html"))
    assert all(not i["url"].startswith("data:") for i in images)


def test_duplicate_image_kept_once():
    images = flatten_images(_sections("gallery.html"))
    urls = [i["url"] for i in images]
    assert len(urls) == len(set(urls))
    assert urls.count("https://docs.example/img/kb-65.png") == 1


def test_noise_image_skipped():
    images = flatten_images(_sections("gallery.html"))
    assert all("pixel" not in i["url"] for i in images)


def test_image_list_capped_at_40():
    sections = [{"heading": "g", "blocks": [
        {"type": "img", "src": f"https://x.example/{i}.png", "alt": ""} for i in range(50)
    ]}]
    assert len(flatten_images(sections)) == 40


def test_page_without_images_yields_empty_list():
    assert flatten_images(_sections("no-images.html")) == []


def test_fallback_page_has_no_images():
    assert flatten_images([]) == []


def test_images_are_subset_of_sections():
    sections = _sections("gallery.html")
    block_srcs = {b["src"] for b in _img_blocks(sections)}
    assert {i["url"] for i in flatten_images(sections)} <= block_srcs


def test_srcset_only_lazy_image_extracted():
    html = (
        "<article><p>" + "x" * 40 + "</p>"
        '<img srcset="https://docs.example/a-1x.png 1x, https://docs.example/a-2x.png 2x" alt="lazy">'
        "<img src=https://docs.example/b.png alt=bare>"
        "</article>"
    )
    sections, _ = extract_sections(html, PAGE_URL, 6000)
    assert [i["url"] for i in flatten_images(sections)] == [
        "https://docs.example/a-1x.png",
        "https://docs.example/b.png",
    ]


def test_leading_section_heading_is_empty():
    sections, _ = extract_sections(
        "<article><h1>Guide</h1><p>" + "x" * 40 + "</p>"
        "<img src='/c.png'></article>",
        PAGE_URL,
        6000,
    )
    assert sections[0]["heading"] == ""
    assert flatten_images(sections)[0]["heading"] == ""


def test_text_markers_skip_noise_images():
    sections = [{"heading": "", "blocks": [
        {"type": "img", "src": "https://x.example/pixel.gif", "alt": ""},
        {"type": "img", "src": "https://x.example/ok.png", "alt": ""},
        {"type": "p", "text": "body"},
    ]}]
    text = sections_to_text(sections)
    assert "pixel" not in text
    assert "[image: https://x.example/ok.png]" in text


def test_fetch_srcs_accept_srcset_and_unquoted():
    html = (
        '<img srcset="https://x.example/a.png 1x, https://x.example/b.png 2x">'
        '<img src="https://x.example/c.png">'
        "<img data-src=https://x.example/d.png>"
    )
    assert _img_srcs(html) == [
        "https://x.example/a.png",
        "https://x.example/c.png",
        "https://x.example/d.png",
    ]
