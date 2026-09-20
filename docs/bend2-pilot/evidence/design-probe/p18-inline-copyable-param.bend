import Base

def dbl(+a: U32) -> U32:
  U32.add(a, a)

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(U32.show(dbl(21)))
