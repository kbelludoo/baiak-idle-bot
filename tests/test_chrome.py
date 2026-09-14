from chrome import describe, gl_mode, launch_args, should_abort, viewport


def test_abort_fonts_and_trackers():
    assert should_abort("https://baiakidle.com/x.woff2", "font")
    assert should_abort("https://www.google-analytics.com/g/collect", "script")
    assert not should_abort("https://baiakidle.com/jogar/", "document")
    assert not should_abort("https://baiakidle.com/assets/sprite.png", "image")


def test_gpu_off_by_default():
    assert gl_mode() == "off"
    args = launch_args()
    assert "--disable-gpu" in args
    assert "--enable-unsafe-swiftshader" not in args
    assert "--single-process" not in args
    vp = viewport()
    assert vp == {"width": 800, "height": 540}
    assert "screenshot" not in describe()


if __name__ == "__main__":
    test_abort_fonts_and_trackers()
    test_gpu_off_by_default()
    print("ok")
