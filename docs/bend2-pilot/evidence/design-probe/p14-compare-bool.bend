import Base

def main() -> IO(Unit):
  do IO<Unit>:
    +a : U32 = 6
    IO.print(Bool.show(U32.is_eq(a, 6)))
