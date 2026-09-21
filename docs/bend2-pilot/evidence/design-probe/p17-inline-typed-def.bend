import Base

def add2(a: U32, b: U32) -> U32:
  U32.add(a, b)

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(U32.show(add2(2, 3)))
