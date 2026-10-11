from mypackage.calc import get_range


def test_get_range():
    assert get_range(5) == [1, 2, 3, 4, 5]
