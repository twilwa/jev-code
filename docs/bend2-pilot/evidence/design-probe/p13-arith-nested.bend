import Base

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    +a : U32 = 6
    +b : U32 = 7
    IO.print(U32.show(U32.mul(U32.add(a, 0), b)))
